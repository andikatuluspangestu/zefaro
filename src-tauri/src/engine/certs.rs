//! HTTPS for sites: Zefaro's local certificate authority (CA) and one
//! certificate per secured site, which nginx serves on port 443.
//!
//! How the CA is kept safe:
//! - It can only vouch for local names. Its Name Constraints extension permits
//!   DNS names under Zefaro's TLD (`.test`) and excludes every IP address, so
//!   browsers reject anything it signs for a real website — even if its key
//!   were stolen.
//! - Its private key is encrypted with Windows DPAPI for the current Windows
//!   user, so the key file is useless on another machine or account.
//! - Zefaro never trusts the CA by itself. Trusting is a button the user
//!   presses; Windows then shows its own confirmation dialog before adding the
//!   CA to the current user's Trusted Root store (no admin rights involved).
//!   Removing it works the same way, and the uninstaller removes it too.

use crate::error::{AppError, AppResult};
use rcgen::{
    BasicConstraints, CertificateParams, CidrSubnet, DistinguishedName, DnType,
    ExtendedKeyUsagePurpose, GeneralSubtree, IsCa, Issuer, KeyPair, KeyUsagePurpose,
    NameConstraints, SerialNumber,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use time::OffsetDateTime;

/// The CA's Common Name starts with this; the uninstaller matches on it.
pub const CA_NAME: &str = "Zefaro Local CA";
const ORGANIZATION: &str = "Zefaro local development";
const CA_YEARS: i64 = 10;
/// Under the 398 days browsers accept for a server certificate.
const SITE_DAYS: i64 = 397;
/// Site certificates are re-issued once they are this old.
const RENEW_AFTER: Duration = Duration::from_secs(300 * 24 * 3600);

/// Where certificates live: `~/.config/zefaro/certs` in production.
#[derive(Clone, Debug)]
pub struct Layout {
    pub root: PathBuf,
}

impl Layout {
    pub fn standard() -> Self {
        Self { root: crate::config::config_dir().join("certs") }
    }
    pub fn at(root: PathBuf) -> Self {
        Self { root }
    }
    fn ca_dir(&self) -> PathBuf {
        self.root.join("ca")
    }
    /// The CA certificate (public; this is what gets trusted).
    pub fn ca_cert(&self) -> PathBuf {
        self.ca_dir().join("zefaro-ca.crt")
    }
    /// The CA private key, DPAPI-encrypted.
    fn ca_key(&self) -> PathBuf {
        self.ca_dir().join("zefaro-ca.key.dpapi")
    }
    fn ca_meta(&self) -> PathBuf {
        self.ca_dir().join("ca.json")
    }
    fn sites_dir(&self) -> PathBuf {
        self.root.join("sites")
    }
}

/// Facts about the CA kept next to it, so status checks needn't parse X.509.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaMeta {
    pub tld: String,
    /// SHA-1 of the certificate (Windows' "thumbprint"), upper-case hex.
    pub thumbprint: String,
    /// Unix seconds.
    pub expires: i64,
}

/// A site's certificate and key files, as nginx needs them.
#[derive(Clone, Debug, PartialEq)]
pub struct SiteFiles {
    pub cert: PathBuf,
    pub key: PathBuf,
}

pub fn site_files(l: &Layout, host: &str) -> SiteFiles {
    SiteFiles {
        cert: l.sites_dir().join(format!("{host}.crt")),
        key: l.sites_dir().join(format!("{host}.key")),
    }
}

fn rc(e: rcgen::Error) -> AppError {
    AppError::msg(crate::tr!(format!("Certificate error: {e}"), format!("Kesalahan sertifikat: {e}")))
}

fn random_serial() -> AppResult<SerialNumber> {
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; 16];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| {
            AppError::msg(crate::tr!(
                "Zefaro couldn't generate a random serial number.",
                "Zefaro tidak dapat membuat nomor seri acak."
            ))
        })?;
    bytes[0] &= 0x7f; // keep it a positive integer
    Ok(SerialNumber::from_slice(&bytes))
}

/// The CA's identity. Rebuilt the same way every time: signing a site
/// certificate needs only these names, the key-id method and the key.
fn ca_params(tld: &str) -> CertificateParams {
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, format!("{CA_NAME} (.{tld})"));
    dn.push(DnType::OrganizationName, ORGANIZATION);
    p.distinguished_name = dn;
    // May sign site certificates only, never another CA.
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    p.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    p.name_constraints = Some(NameConstraints {
        permitted_subtrees: vec![GeneralSubtree::DnsName(tld.to_owned())],
        excluded_subtrees: vec![
            GeneralSubtree::IpAddress(CidrSubnet::V4([0; 4], [0; 4])),
            GeneralSubtree::IpAddress(CidrSubnet::V6([0; 16], [0; 16])),
        ],
    });
    p
}

fn thumbprint(der: &[u8]) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, der);
    digest.as_ref().iter().map(|b| format!("{b:02X}")).collect()
}

pub fn read_meta(l: &Layout) -> Option<CaMeta> {
    let text = fs::read_to_string(l.ca_meta()).ok()?;
    let meta: CaMeta = serde_json::from_str(&text).ok()?;
    (l.ca_cert().is_file() && l.ca_key().is_file()).then_some(meta)
}

fn create_ca(l: &Layout, tld: &str) -> AppResult<CaMeta> {
    let key = KeyPair::generate().map_err(rc)?;
    let mut params = ca_params(tld);
    let now = OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::days(1);
    params.not_after = now + time::Duration::days(365 * CA_YEARS);
    params.serial_number = Some(random_serial()?);
    let cert = params.self_signed(&key).map_err(rc)?;

    fs::create_dir_all(l.ca_dir())?;
    // Site certificates signed by a previous CA are no longer valid.
    let _ = fs::remove_dir_all(l.sites_dir());
    fs::write(l.ca_key(), dpapi::protect(key.serialize_pem().as_bytes())?)?;
    fs::write(l.ca_cert(), cert.pem())?;
    let meta = CaMeta {
        tld: tld.to_owned(),
        thumbprint: thumbprint(cert.der()),
        expires: params.not_after.unix_timestamp(),
    };
    fs::write(l.ca_meta(), serde_json::to_string_pretty(&meta)?)?;
    // PHP's CA bundle carries the CA, so PHP trusts secured sites too.
    if l.root == Layout::standard().root {
        crate::engine::cabundle::rebuild();
    }
    Ok(meta)
}

/// The CA for `tld`, created on first use (or when the TLD changed).
pub fn ensure_ca(l: &Layout, tld: &str) -> AppResult<CaMeta> {
    match read_meta(l) {
        Some(meta) if meta.tld == tld && meta.expires > OffsetDateTime::now_utc().unix_timestamp() => Ok(meta),
        _ => create_ca(l, tld),
    }
}

fn ca_key(l: &Layout) -> AppResult<KeyPair> {
    let sealed = fs::read(l.ca_key())?;
    let pem = dpapi::unprotect(&sealed)
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Zefaro couldn't unlock its CA key. Another Windows user may have created it. {e}"),
                format!("Zefaro tidak dapat membuka kunci CA-nya. Mungkin kunci itu dibuat oleh pengguna Windows lain. {e}")
            ))
        })?;
    let pem = String::from_utf8(pem)
        .map_err(|_| AppError::msg(crate::tr!("Zefaro's CA key file is damaged.", "File kunci CA Zefaro rusak.")))?;
    KeyPair::from_pem(&pem).map_err(rc)
}

fn issue_site(l: &Layout, meta: &CaMeta, host: &str) -> AppResult<SiteFiles> {
    if !(host == meta.tld || host.ends_with(&format!(".{}", meta.tld))) {
        return Err(AppError::msg(crate::tr!(
            format!("{host} isn't under .{}.", meta.tld),
            format!("{host} tidak berada di bawah .{}.", meta.tld)
        )));
    }
    let ca_key = ca_key(l)?;
    let issuer = Issuer::new(ca_params(&meta.tld), &ca_key);

    let key = KeyPair::generate().map_err(rc)?;
    let mut params = CertificateParams::new(vec![host.to_owned(), format!("*.{host}")]).map_err(rc)?;
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, host);
    params.distinguished_name.push(DnType::OrganizationName, ORGANIZATION);
    params.is_ca = IsCa::ExplicitNoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.use_authority_key_identifier_extension = true;
    let now = OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::days(1);
    params.not_after = now + time::Duration::days(SITE_DAYS);
    params.serial_number = Some(random_serial()?);
    let cert = params.signed_by(&key, &issuer).map_err(rc)?;

    let files = site_files(l, host);
    fs::create_dir_all(l.sites_dir())?;
    fs::write(&files.key, key.serialize_pem())?;
    fs::write(&files.cert, cert.pem())?;
    Ok(files)
}

fn modified(p: &Path) -> Option<SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// The certificate for `host` (e.g. `blog.test`), issued when missing, older
/// than the CA, or due for renewal.
pub fn ensure_site(l: &Layout, tld: &str, host: &str) -> AppResult<SiteFiles> {
    let meta = ensure_ca(l, tld)?;
    let files = site_files(l, host);
    let fresh = match (modified(&files.cert), modified(&files.key), modified(&l.ca_cert())) {
        (Some(cert), Some(_), Some(ca)) => {
            cert >= ca && cert.elapsed().map(|age| age < RENEW_AFTER).unwrap_or(false)
        }
        _ => false,
    };
    if fresh {
        Ok(files)
    } else {
        issue_site(l, &meta, host)
    }
}

/// Delete a site's certificate (when HTTPS is turned off or the site unlinked).
pub fn remove_site(l: &Layout, host: &str) {
    let files = site_files(l, host);
    let _ = fs::remove_file(files.cert);
    let _ = fs::remove_file(files.key);
}

fn ca_der(l: &Layout) -> AppResult<Vec<u8>> {
    let pem = fs::read_to_string(l.ca_cert())?;
    let body: String = pem.lines().filter(|line| !line.starts_with("-----")).collect();
    base64_decode(&body).ok_or_else(|| {
        AppError::msg(crate::tr!("Zefaro's CA certificate file is damaged.", "File sertifikat CA Zefaro rusak."))
    })
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let v = ALPHABET.iter().position(|&a| a == c)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// Is the CA in the current user's Trusted Root store?
pub fn is_trusted(l: &Layout) -> bool {
    ca_der(l).map(|der| store::contains(&der)).unwrap_or(false)
}

/// Add the CA to the current user's Trusted Root store. Windows shows its own
/// confirmation dialog first; declining it returns an error.
pub fn trust(l: &Layout) -> AppResult<()> {
    store::add(&ca_der(l)?)
}

/// Remove the CA from the Trusted Root store (Windows asks to confirm).
pub fn untrust(l: &Layout) -> AppResult<()> {
    store::remove(&ca_der(l)?)
}

/// DPAPI: encrypt data so only the current Windows user can decrypt it.
mod dpapi {
    use crate::error::{AppError, AppResult};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Extra input both calls must agree on, so another program's DPAPI blob
    /// can't be passed off as Zefaro's key.
    const ENTROPY: &[u8] = b"Zefaro local CA private key";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    /// Copy out a buffer Windows allocated with LocalAlloc, then free it.
    fn take(ok: i32, out: CRYPT_INTEGER_BLOB) -> AppResult<Vec<u8>> {
        if ok == 0 {
            return Err(AppError::msg(std::io::Error::last_os_error().to_string()));
        }
        // SAFETY: on success `out` holds cbData bytes owned by us.
        unsafe {
            let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(out.pbData as _);
            Ok(bytes)
        }
    }

    pub fn protect(data: &[u8]) -> AppResult<Vec<u8>> {
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: the input blobs point at slices that outlive the call.
        let ok = unsafe {
            CryptProtectData(&blob(data), std::ptr::null(), &blob(ENTROPY), std::ptr::null(),
                std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        take(ok, out)
    }

    pub fn unprotect(data: &[u8]) -> AppResult<Vec<u8>> {
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as in `protect`.
        let ok = unsafe {
            CryptUnprotectData(&blob(data), std::ptr::null_mut(), &blob(ENTROPY), std::ptr::null(),
                std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        take(ok, out)
    }
}

/// The current user's Trusted Root certificate store.
mod store {
    use crate::error::{AppError, AppResult};
    use windows_sys::Win32::Security::Cryptography::{
        CertAddCertificateContextToStore, CertCloseStore, CertCreateCertificateContext,
        CertDeleteCertificateFromStore, CertFindCertificateInStore, CertFreeCertificateContext,
        CertOpenStore, CERT_CONTEXT, CERT_FIND_EXISTING, CERT_STORE_ADD_REPLACE_EXISTING,
        CERT_STORE_OPEN_EXISTING_FLAG, CERT_STORE_PROV_SYSTEM_W, CERT_STORE_READONLY_FLAG,
        CERT_SYSTEM_STORE_CURRENT_USER, HCERTSTORE, PKCS_7_ASN_ENCODING, X509_ASN_ENCODING,
    };

    const ENCODING: u32 = X509_ASN_ENCODING | PKCS_7_ASN_ENCODING;
    /// ERROR_CANCELLED as an HRESULT: the user chose "No" in Windows' dialog.
    const CANCELLED: i32 = 0x800704C7u32 as i32;

    struct Store(HCERTSTORE);
    impl Drop for Store {
        fn drop(&mut self) {
            // SAFETY: opened by `open` and closed once.
            unsafe { CertCloseStore(self.0, 0) };
        }
    }

    struct Cert(*const CERT_CONTEXT);
    impl Drop for Cert {
        fn drop(&mut self) {
            // SAFETY: created by CertCreateCertificateContext or found in a store.
            unsafe { CertFreeCertificateContext(self.0) };
        }
    }

    fn open(read_only: bool) -> AppResult<Store> {
        let name: Vec<u16> = "Root\0".encode_utf16().collect();
        let mut flags = CERT_SYSTEM_STORE_CURRENT_USER | CERT_STORE_OPEN_EXISTING_FLAG;
        if read_only {
            flags |= CERT_STORE_READONLY_FLAG;
        }
        // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the call.
        let h = unsafe { CertOpenStore(CERT_STORE_PROV_SYSTEM_W, 0, 0, flags, name.as_ptr() as _) };
        if h.is_null() {
            let e = std::io::Error::last_os_error();
            return Err(AppError::msg(crate::tr!(
                format!("Zefaro couldn't open the Windows certificate store: {e}"),
                format!("Zefaro tidak dapat membuka penyimpanan sertifikat Windows: {e}")
            )));
        }
        Ok(Store(h))
    }

    fn context(der: &[u8]) -> AppResult<Cert> {
        // SAFETY: Windows copies the bytes into the new context.
        let c = unsafe { CertCreateCertificateContext(ENCODING, der.as_ptr(), der.len() as u32) };
        if c.is_null() {
            return Err(AppError::msg(crate::tr!(
                "Windows couldn't read Zefaro's CA certificate.",
                "Windows tidak dapat membaca sertifikat CA Zefaro."
            )));
        }
        Ok(Cert(c))
    }

    fn find(store: &Store, cert: &Cert) -> Option<Cert> {
        // SAFETY: both handles are live; the result is ours to free.
        let found = unsafe {
            CertFindCertificateInStore(store.0, ENCODING, 0, CERT_FIND_EXISTING, cert.0 as _, std::ptr::null())
        };
        (!found.is_null()).then_some(Cert(found))
    }

    pub fn contains(der: &[u8]) -> bool {
        match (open(true), context(der)) {
            (Ok(store), Ok(cert)) => find(&store, &cert).is_some(),
            _ => false,
        }
    }

    fn declined_or(what: &str) -> AppError {
        let e = std::io::Error::last_os_error();
        if e.raw_os_error() == Some(CANCELLED) || e.raw_os_error() == Some(1223) {
            AppError::msg(crate::tr!(
                format!("{what} was cancelled in the Windows confirmation dialog."),
                format!("{what} dibatalkan di dialog konfirmasi Windows.")
            ))
        } else {
            AppError::msg(crate::tr!(format!("{what} failed: {e}"), format!("{what} gagal: {e}")))
        }
    }

    pub fn add(der: &[u8]) -> AppResult<()> {
        let store = open(false)?;
        let cert = context(der)?;
        // SAFETY: live handles. Windows shows its security warning here.
        let ok = unsafe {
            CertAddCertificateContextToStore(store.0, cert.0, CERT_STORE_ADD_REPLACE_EXISTING, std::ptr::null_mut())
        };
        if ok == 0 {
            return Err(declined_or(crate::tr!(
                "Trusting Zefaro's certificate authority",
                "Memercayai otoritas sertifikat Zefaro"
            )));
        }
        Ok(())
    }

    pub fn remove(der: &[u8]) -> AppResult<()> {
        let store = open(false)?;
        let cert = context(der)?;
        let Some(found) = find(&store, &cert) else {
            return Ok(());
        };
        // CertDeleteCertificateFromStore frees the context, success or not.
        let ptr = found.0;
        std::mem::forget(found);
        // SAFETY: `ptr` came from CertFindCertificateInStore on this store.
        if unsafe { CertDeleteCertificateFromStore(ptr) } == 0 {
            return Err(declined_or(crate::tr!(
                "Removing Zefaro's certificate authority",
                "Menghapus kepercayaan otoritas sertifikat Zefaro"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_layout(tag: &str) -> Layout {
        let dir = std::env::temp_dir().join(format!("zefaro-certs-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Layout::at(dir)
    }

    #[test]
    fn dpapi_round_trip() {
        let sealed = dpapi::protect(b"secret key").unwrap();
        assert_ne!(sealed, b"secret key");
        assert_eq!(dpapi::unprotect(&sealed).unwrap(), b"secret key");
    }

    #[test]
    fn base64_matches_known_values() {
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("TWFu\nTWE=").unwrap(), b"ManMa");
        assert!(base64_decode("a$b").is_none());
    }

    #[test]
    fn creates_ca_once_and_issues_site_certificates() {
        let l = temp_layout("issue");
        let ca = ensure_ca(&l, "test").unwrap();
        assert_eq!(ca.thumbprint.len(), 40);
        assert!(!fs::read_to_string(l.ca_key()).map(|s| s.contains("PRIVATE KEY")).unwrap_or(false),
            "the CA key must not be stored in the clear");
        // Second call reuses it.
        assert_eq!(ensure_ca(&l, "test").unwrap(), ca);
        assert_eq!(thumbprint(&ca_der(&l).unwrap()), ca.thumbprint);

        let files = ensure_site(&l, "test", "blog.test").unwrap();
        let pem = fs::read_to_string(&files.cert).unwrap();
        assert!(pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(fs::read_to_string(&files.key).unwrap().contains("PRIVATE KEY"));
        // Fresh certificates are kept, not re-issued.
        let before = modified(&files.cert);
        ensure_site(&l, "test", "blog.test").unwrap();
        assert_eq!(modified(&files.cert), before);

        assert!(issue_site(&l, &ca, "example.com").is_err());
        remove_site(&l, "blog.test");
        assert!(!files.cert.exists());

        // A different TLD gets a new CA.
        assert_ne!(ensure_ca(&l, "localdev").unwrap().thumbprint, ca.thumbprint);
        fs::remove_dir_all(&l.root).ok();
    }

    /// Writes a CA, a site certificate and a certificate for a real domain
    /// signed by the same CA to $ZEFARO_CERT_DUMP, for checking with
    /// `openssl verify` (which enforces name constraints). Run manually.
    #[test]
    #[ignore]
    fn dump_for_openssl() {
        let l = Layout::at(PathBuf::from(std::env::var("ZEFARO_CERT_DUMP").unwrap()));
        let meta = ensure_ca(&l, "test").unwrap();
        ensure_site(&l, "test", "blog.test").unwrap();
        // Bypass issue_site's own check to prove the constraint holds anyway.
        let key = KeyPair::generate().unwrap();
        let mut p = CertificateParams::new(vec!["www.google.com".to_owned()]).unwrap();
        p.use_authority_key_identifier_extension = true;
        let ca_key = ca_key(&l).unwrap();
        let rogue = p.signed_by(&key, &Issuer::new(ca_params(&meta.tld), &ca_key)).unwrap();
        fs::write(l.root.join("rogue.crt"), rogue.pem()).unwrap();
    }
}
