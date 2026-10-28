// Isi dokumentasi dalam Bahasa Indonesia. Bagian, id, ikon, urutan, dan fakta
// (versi, path, port, batas) sama persis dengan sections.tsx; ubah keduanya bersamaan.
// Nama tombol dan halaman mengikuti teks antarmuka Indonesia.

import type { ReactNode } from "react";
import { C, CodeBlock, H3, List, Note, P, Rows, Steps } from "./blocks";
import { FaqList, GoTo, LARAVEL_ENV, type DocSection } from "./sections";

const FAQ: [string, ReactNode][] = [
  [
    "Apakah Zefaro benar-benar gratis?",
    <>Ya, semua fiturnya: beberapa versi PHP berdampingan, HTTPS, MariaDB, PostgreSQL, Redis, phpMyAdmin,
    Mailpit, Node.js, penampil log, dan DNS lokal. Tidak ada versi berbayar.</>,
  ],
  [
    "Apakah Zefaro punya fitur AI atau cloud?",
    <>Tidak, dan itu disengaja. Zefaro adalah lingkungan pengembangan lokal, tidak lebih.</>,
  ],
  [
    "Apakah Zefaro mengirim data ke mana pun?",
    <>Zefaro tidak memakai akun dan tidak mengirim analitik. Zefaro hanya terhubung ke internet untuk
    memeriksa versi baru dan mengunduh software yang tercantum di halaman Tentang, dari sumber
    resmi setiap proyek.</>,
  ],
  [
    "Apakah Zefaro akan mengganggu PHP atau Composer yang sudah saya punya?",
    <>Tidak. Semuanya ada di <C>%USERPROFILE%\.config\zefaro</C>, dan Composer memakai{" "}
    <C>COMPOSER_HOME</C> milik Zefaro sendiri. Satu-satunya pengaturan bersama adalah PATH Anda, dan
    Zefaro hanya mengubahnya saat Anda mengklik <em>Tambahkan ke PATH</em>. Setelah itu folder Zefaro
    ada di urutan pertama, jadi <C>php</C> menjalankan PHP aktif milik Zefaro.</>,
  ],
  [
    "Mengapa phpMyAdmin butuh PHP 8.3 atau yang lebih lama?",
    <>phpMyAdmin 5.2.3 secara resmi mendukung PHP 7.2 sampai 8.3. Zefaro menjalankannya dengan versi
    terbaru yang terpasang dalam rentang itu, jadi Anda tetap bisa memakai PHP 8.4 atau 8.5 untuk
    situs Anda sendiri.</>,
  ],
  [
    "Mengapa pemasangan DNS meminta hak admin?",
    <>Mengarahkan pencarian <C>.test</C> ke Zefaro adalah pengaturan sistem Windows. Anda cukup
    menyetujuinya sekali; setelah itu server DNS Zefaro berjalan sebagai program biasa.</>,
  ],
  [
    "Apakah memercayai sertifikat Zefaro berisiko?",
    <>Risikonya kecil. Otoritas sertifikat Zefaro hanya bisa menandatangani nama <C>.test</C>, dan
    browser menegakkan batasan itu, jadi tidak ada yang bisa memakainya untuk menyamar sebagai situs
    web sungguhan. Kuncinya dienkripsi untuk akun Windows Anda, dan Anda bisa menghapusnya di
    Pengaturan, bagian HTTPS.</>,
  ],
  [
    "Di mana database saya disimpan?",
    <>Di <C>%USERPROFILE%\.config\zefaro\data\mariadb</C>. Untuk menyimpan salinannya, hentikan
    MariaDB lalu cadangkan folder itu, atau ekspor setiap database dari halaman Database.</>,
  ],
  [
    "Bisakah komputer lain di jaringan saya membuka situs saya?",
    <>Tidak. nginx, PHP, MariaDB, PostgreSQL, Redis, Mailpit, dan server DNS hanya mendengarkan di{" "}
    <C>127.0.0.1</C>.</>,
  ],
];

export const SECTIONS_ID: DocSection[] = [
  {
    id: "getting-started",
    title: "Memulai",
    icon: "rocket",
    group: "Mulai di sini",
    summary: "Dari instalasi baru sampai situs berjalan di nama.test.",
    body: (go) => (
      <>
        <P>
          Zefaro menyajikan proyek PHP dari folder di komputer Anda di alamat seperti{" "}
          <C>http://my-app.test</C>. Lima langkah membawa Anda dari instalasi baru ke situs yang
          berjalan.
        </P>
        <Steps
          items={[
            <>
              <strong>Instal PHP.</strong> Di halaman Layanan, klik <em>Instal PHP</em>, pilih
              versi, lalu klik <em>Instal</em>. Versi pertama yang Anda instal menjadi versi aktif.
              <GoTo page="services" label="Buka Layanan" go={go} />
            </>,
            <>
              <strong>Mulai layanan inti</strong> dengan <em>Mulai semua</em>: nginx (server web),
              PHP, dan DNS. Zefaro mengunduh nginx saat pertama kali (sekitar 3 MB).
            </>,
            <>
              <strong>Pasang DNS sekali saja.</strong> Klik <em>Mulai</em> di kartu DNS. Pada kali
              pertama, Zefaro justru membuka pengaturan DNS: klik <em>Pasang aturan</em> dan setujui
              permintaan Windows. Sejak itu, setiap nama <C>*.test</C> mengarah ke Zefaro.
            </>,
            <>
              <strong>Tautkan folder proyek</strong> di halaman Situs.
              <GoTo page="sites" label="Buka Situs" go={go} />
            </>,
            <>
              <strong>Buka situsnya</strong> di <C>http://&lt;nama-folder&gt;.test</C>.
            </>,
          ]}
        />
        <P>
          Halaman Beranda ikut menghitung. Selama situs pertama Anda belum berjalan, halaman itu
          menampilkan langkah-langkah ini dan mencentang yang sudah selesai. Setelah itu, Beranda
          menampilkan apa yang berjalan, situs Anda, dan hal yang perlu perhatian, misalnya
          layanan yang gagal dimulai.
          <GoTo page="home" label="Buka Beranda" go={go} />
        </P>
        <H3>Terang dan gelap</H3>
        <P>
          Zefaro mengikuti tema Windows secara bawaan dan berganti saat Windows berganti. Untuk
          memilih sendiri, buka <em>Pengaturan</em>, lalu <em>Tampilan</em>, dan pilih terang atau
          gelap.
        </P>
        <H3>Kebutuhan sistem</H3>
        <List
          items={[
            "Windows 10 atau 11, 64-bit.",
            "Microsoft Edge WebView2 Runtime (sudah ada di Windows 11 dan Microsoft Edge).",
            <>
              Microsoft Visual C++ Redistributable (x64), yang dibutuhkan PHP. Jika belum ada, Zefaro
              memberi tahu Anda setelah PHP terinstal dan memberi tautan ke unduhannya.
            </>,
            "Koneksi internet saat Zefaro mengunduh software. Setelah itu semuanya berjalan offline.",
          ]}
        />
      </>
    ),
  },
  {
    id: "install",
    title: "Instal dan copot",
    icon: "download",
    group: "Mulai di sini",
    summary: "Apa yang diubah installer dan uninstaller di Windows.",
    body: () => (
      <>
        <H3>Menginstal</H3>
        <P>
          Jalankan <C>Zefaro_&lt;versi&gt;_x64-setup.exe</C>. Zefaro terinstal untuk akun Windows Anda
          saja, jadi tidak perlu hak admin. Installer menaruhnya di <C>%LOCALAPPDATA%\Zefaro</C> dan
          menambahkan pintasan di menu Start, ditambah pintasan desktop jika kotaknya tetap Anda
          centang di halaman terakhir. Jika Microsoft Edge WebView2 Runtime belum ada, installer
          mengunduhnya.
        </P>
        <Note title="Windows melindungi PC Anda" warn>
          Installer ini belum memiliki tanda tangan kode, jadi SmartScreen mungkin memperingatkan
          tentang aplikasi yang tidak dikenal. Klik <em>Info selengkapnya</em>, lalu{" "}
          <em>Tetap jalankan</em>.
        </Note>
        <H3>Memperbarui</H3>
        <P>
          Jalankan installer yang lebih baru di atas yang lama. Situs, pengaturan, database, entri
          PATH, dan aturan DNS Anda tetap seperti semula.
        </P>
        <H3>Mencopot</H3>
        <P>
          Buka <em>Pengaturan, Aplikasi, Aplikasi terinstal</em> di Windows, cari Zefaro, lalu pilih{" "}
          <em>Hapus instalan</em>. Selain aplikasinya sendiri, uninstaller menghapus apa yang
          ditambahkan Zefaro ke Windows:
        </P>
        <List
          items={[
            <>Folder <C>bin</C> milik Zefaro dari PATH Anda.</>,
            <>
              Aturan DNS untuk <C>.test</C>. Windows meminta hak admin; jika Anda menolak, aturan
              itu tetap ada dan bisa Anda hapus nanti.
            </>,
            <>Otoritas sertifikat HTTPS milik Zefaro, jika Anda memercayainya. Windows meminta konfirmasi Anda.</>,
          ]}
        />
        <P>
          Uninstaller tetap menyimpan situs, pengaturan, dan database Anda di{" "}
          <C>%USERPROFILE%\.config\zefaro</C>, jadi instalasi ulang melanjutkan dari kondisi
          terakhir. Hapus folder itu untuk menghapus semuanya, termasuk database Anda. Kotak{" "}
          <em>Hapus data aplikasi</em> di uninstaller hanya membersihkan data browser milik jendela
          aplikasi.
        </P>
      </>
    ),
  },
  {
    id: "sites",
    title: "Situs",
    icon: "globe",
    group: "Situs dan runtime",
    summary: "Folder yang ditautkan, alamatnya, dan HTTPS.",
    body: (go) => (
      <>
        <P>
          Situs adalah folder yang disajikan Zefaro di <C>&lt;nama&gt;.test</C>. Klik{" "}
          <em>Tautkan folder</em> lalu pilih proyek Anda. Zefaro mengenali isi folder (Laravel, Symfony,
          WordPress, Drupal, Craft, Magento, dan lainnya) dan menampilkan ikonnya di samping nama.
          Jika <C>APP_URL</C> proyek masih mengarah ke <C>localhost</C> atau alamat <C>.test</C>{" "}
          lama, menautkannya atau menyalakan dan mematikan HTTPS memperbaruinya; domain sungguhan
          dibiarkan.
          <GoTo page="sites" label="Buka Situs" go={go} />
        </P>
        <Rows
          rows={[
            [
              "Nama",
              <>
                Nama folder dalam huruf kecil, dengan semua karakter selain huruf dan angka diganti
                tanda hubung: <C>My App_v2</C> menjadi <C>my-app-v2.test</C>. Subdomain seperti{" "}
                <C>api.my-app.test</C> mengarah ke situs yang sama.
              </>,
            ],
            [
              "Document root",
              <>
                Subfolder <C>public</C> jika ada (Laravel, Symfony, dan sebagian besar framework),
                selain itu folder itu sendiri.
              </>,
            ],
            [
              "Routing",
              <>
                Permintaan untuk file yang tidak ada diteruskan ke <C>index.php</C>, jadi route
                framework dan URL yang rapi tetap berfungsi.
              </>,
            ],
            [
              "Versi PHP",
              <>
                Versi yang aktif saat Anda menautkan situs. Jika versi itu sudah tidak terpasang,
                situs memakai versi aktif.
              </>,
            ],
            ["Lepas tautan", "Zefaro berhenti menyajikan situs itu. File Anda tidak pernah disentuh."],
          ]}
        />
        <H3>Situs baru</H3>
        <P>
          <em>Situs baru</em> membuat aplikasi Laravel dengan installer Laravel dan langsung
          menyajikannya. Pilih nama (huruf kecil, angka, dan tanda hubung; menjadi nama folder dan{" "}
          <C>&lt;nama&gt;.test</C>), folder tempat membuatnya, dan versi PHP.
        </P>
        <Rows
          rows={[
            [
              "Starter kit",
              <>
                Laravel polos, atau kit resmi React, Vue, Livewire, dan Svelte, dengan atau tanpa
                halaman login dan tim. <em>Komunitas</em> menerima paket Composer kit apa pun.
              </>,
            ],
            [
              "Database",
              <>
                SQLite (satu file di proyek) atau MariaDB milik Zefaro, tempat Zefaro membuat database
                bernama sesuai situs (<C>my-app</C> menjadi <C>my_app</C>) lalu memigrasikannya.
              </>,
            ],
            [
              "Opsi",
              <>
                Pest atau PHPUnit, build front end dengan Node.js milik Zefaro, repositori Git,
                HTTPS, dan mengirim email ke Mailpit.
              </>,
            ],
          ]}
        />
        <P>
          Setelah itu Zefaro menautkan folder dengan versi PHP pilihan dan mengisi <C>APP_URL</C>,
          serta nilai email dan database di <C>.env</C>. Installer butuh Composer dan installer
          Laravel; wizard menawarkan memasang keduanya. Laravel Boost, yang memasang alat koding
          AI, tidak pernah dipasang.
        </P>
        <H3>HTTPS</H3>
        <P>
          Klik <em>Amankan</em> pada sebuah situs untuk menyajikannya di{" "}
          <C>https://&lt;nama&gt;.test</C>. Zefaro menandatangani sertifikat untuk situs itu beserta
          subdomainnya, lalu <C>http://</C> biasa dialihkan ke HTTPS. Klik <em>Aman</em> untuk
          mematikannya lagi.
        </P>
        <P>
          Sertifikat itu berasal dari otoritas sertifikat (CA) milik Zefaro sendiri, yang dibuat Zefaro
          saat Anda pertama kali mengamankan situs. Browser menerimanya setelah Anda memercayai CA
          tersebut, cukup sekali:
        </P>
        <Steps
          items={[
            <>
              Klik <em>Percayai sertifikat…</em> di halaman Situs atau di Pengaturan, bagian HTTPS.
            </>,
            <>
              Windows menampilkan peringatan keamanan tentang pemasangan sertifikat. Pastikan
              namanya <em>Zefaro Local CA (.test)</em> dan thumbprint-nya sama dengan yang ada di
              Pengaturan, lalu pilih <em>Ya</em>.
            </>,
            <>Mulai ulang browser jika sedang terbuka.</>,
          ]}
        />
        <Note title="Mengapa CA ini aman dipercaya">
          CA milik Zefaro hanya bisa menandatangani nama <C>.test</C>. Browser menolak apa pun yang
          ditandatanganinya untuk situs web sungguhan atau alamat IP, bahkan jika kuncinya dicuri.
          Kunci itu dienkripsi untuk akun Windows Anda dan tidak pernah keluar dari komputer ini.
          Windows memercayai CA ini untuk akun Anda saja, dan Anda bisa menghapusnya kapan saja di
          Pengaturan. Mencopot Zefaro juga menghapusnya.
        </Note>
        <List
          items={[
            <>
              <strong>Firefox</strong> secara default memakai sertifikat yang dipercaya Windows.
              Jika masih muncul peringatan, setel <C>security.enterprise_roots.enabled</C> ke{" "}
              <C>true</C> di <C>about:config</C>.
            </>,
            <>
              <strong>curl</strong> bawaan Windows butuh <C>--ssl-no-revoke</C> untuk situs{" "}
              <C>.test</C>, karena CA lokal tidak menerbitkan daftar pencabutan.
            </>,
            <>
              <strong>PHP yang memanggil situs aman lain</strong> (misalnya dengan Guzzle atau HTTP
              client Laravel) berjalan: daftar sertifikat yang diberikan Zefaro ke PHP memuat CA Zefaro.
              Daftar itu terbitan Mozilla, yang diunduh ulang Zefaro setiap 30 hari; halaman PHP
              menampilkan kapan, dan bisa memperbaruinya sekarang.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "site-tools",
    title: "Alat situs",
    icon: "screwdriver-wrench",
    group: "Situs dan runtime",
    summary: "Lihat isi aplikasi Laravel: data, config, Tinker, Artisan, dan worker.",
    body: (go) => (
      <>
        <P>
          Klik nama situs di halaman Situs, atau ikon kunci di sebelahnya, untuk membuka
          halamannya. Di bawah namanya, <em>Buka di</em> mendaftar editor, terminal, dan alat
          database yang ditemukan Zefaro di komputer ini (VS Code, PhpStorm, Cursor, Zed, Sublime
          Text, Windows Terminal, Git Bash, HeidiSQL, phpMyAdmin, dan lainnya) lalu membuka folder
          atau database situs di sana. Terminal mulai di folder situs dengan versi PHP situs di
          urutan pertama path. Alat ini butuh proyek Laravel (folder dengan file <C>artisan</C>) yang
          dependensinya sudah terpasang. Jika <C>vendor</C> tidak ada, halaman menawarkan
          menjalankan <C>composer install</C>. Semuanya berjalan dengan versi PHP situs, atau
          versi aktif jika versi situs belum terpasang.
          <GoTo page="sites" label="Buka Situs" go={go} />
        </P>
        <Rows
          rows={[
            [
              "Ringkasan",
              <>
                Versi Laravel dan PHP, environment, driver yang dipakai, dan kondisi aplikasi.
                Halaman memperingatkan masalah umum dan memperbaiki tiap masalah dengan satu
                tombol: app key kosong, database tidak terjangkau (dengan tombol memulai MariaDB),
                migrasi yang belum jalan, email yang tidak sampai ke Mailpit, tautan storage yang
                belum ada, mode debug di production, config yang di-cache, dan antrean tanpa
                worker.
              </>,
            ],
            [
              "Data",
              <>
                Tabel database aplikasi. Telusuri, cari, urutkan, dan filter. Tab ini hanya baca
                sampai Anda menyalakan <em>Izinkan mengubah data</em>, yang memungkinkan klik dua
                kali sel untuk mengubahnya dan menghapus baris. Zefaro memperingatkan jika aplikasi
                berjalan di production atau databasenya tidak ada di komputer ini. Kolom yang
                disembunyikan model, dan apa pun yang namanya mirip password atau token, tampil
                sebagai titik sampai Anda mengklik ikon mata. <em>Setara dengan kode</em> menyalin
                query di layar sebagai kode Eloquent, dan <em>Buka di Tinker</em> memasukkannya ke
                Tinker.
              </>,
            ],
            [
              "Konfigurasi",
              <>
                File <C>.env</C> sebagai editor, nilai yang dilihat aplikasi setelah file
                config-nya digabung (klik satu untuk menyalin pemanggilan <C>config()</C>-nya),
                dan semua route. Menyimpan nilai menulis <C>.env</C>, mengakhiri sesi Tinker agar
                proses berikutnya membacanya, dan membersihkan config yang di-cache.
              </>,
            ],
            [
              "Log",
              <>
                Log milik aplikasi di <C>storage/logs</C>, yang terbaru di atas. Saring per level,
                cari, buka entri untuk melihat konteks dan stack trace-nya, ikuti entri baru saat
                ditulis, atau kosongkan file.
              </>,
            ],
            [
              "Tinker",
              <>
                Tulis PHP lalu tekan <em>Ctrl+Enter</em>. Ekspresi terakhir ditampilkan sebagai
                pohon yang bisa dibuka: model, collection, tanggal, dan array biasa. Sesi tetap
                hidup di antara proses, jadi variabel yang Anda isi tetap ada sampai Anda menekan{" "}
                <em>Reset sesi</em>. Setiap proses juga menampilkan yang dicetaknya, keluaran{" "}
                <C>dump()</C>, error dengan file dan baris, query SQL yang dijalankan beserta
                waktunya, dan pemakaian memori. Tombol panah atas memanggil kode sebelumnya.
              </>,
            ],
            [
              "Artisan",
              <>
                Semua perintah yang dimiliki aplikasi, dikelompokkan menurut nama. Zefaro membuat
                formulir dari argumen dan opsi perintah, menampilkan perintah persis yang akan
                dijalankan, dan menampilkan outputnya langsung. Perintah yang menghapus data{" "}
                (<C>migrate:fresh</C>, <C>migrate:reset</C>, <C>db:wipe</C>, dan sejenisnya) serta{" "}
                <C>key:generate</C> bertanya dulu, dan di production semua perintah <C>migrate</C>{" "}
                dan <C>db</C> juga bertanya.
              </>,
            ],
            [
              "Worker",
              <>
                Perintah yang dijaga Zefaro tetap berjalan untuk situs dan dijalankan ulang jika
                crash: queue worker, scheduler, Vite, Reverb atau Horizon, atau perintah apa pun
                yang Anda tulis. Masing-masing bisa mulai saat Zefaro mulai. Outputnya masuk ke
                halaman Log, di grup Worker.
              </>,
            ],
          ]}
        />
        <H3>Perlu diketahui</H3>
        <List
          items={[
            <>
              <strong>Batalkan perubahan database setelah tiap jalan</strong> di Tinker
              membungkus proses dalam transaksi lalu me-rollback-nya, jadi Anda bisa mencoba
              penulisan dengan aman. Perubahan skema tidak bisa dibatalkan di MariaDB, yang
              langsung meng-commit-nya.
            </>,
            <>
              <strong>exit() dan dd()</strong> mengakhiri proses PHP. Zefaro memberi tahu dan
              memulai sesi baru pada proses berikutnya, jadi variabel sebelumnya hilang. Kode yang
              berjalan lebih dari sepuluh menit dihentikan.
            </>,
            <>
              <strong>Artisan berjalan tanpa pertanyaan</strong> (<C>--no-interaction</C>), jadi
              perintah yang bertanya memakai nilai bawaannya. Perintah yang tidak pernah selesai,
              seperti <C>serve</C> dan <C>queue:work</C>, tidak ada di daftar: pakai Worker untuk
              itu.
            </>,
            <>
              <strong>Worker yang diawali <C>php</C></strong> memakai PHP situs. Selain itu,
              seperti <C>npm run dev</C>, berjalan di command prompt Windows di folder situs,
              dengan Node.js milik Zefaro di urutan pertama path.
            </>,
          ]}
        />
        <Note title="Alat ini menjalankan kode aplikasi">
          Tinker, Artisan, dan worker menjalankan PHP dari proyek dengan izin akun Windows Anda,
          sama seperti menjalankan perintahnya sendiri di terminal. Buka hanya untuk proyek yang
          Anda percayai.
        </Note>
      </>
    ),
  },
  {
    id: "php",
    title: "PHP",
    icon: "php",
    group: "Situs dan runtime",
    summary: "Versi, pengaturan per versi, Composer, dan baris perintah.",
    body: () => (
      <>
        <P>
          PHP ada di halaman Layanan. Ikon roda gigi di kartu PHP mana pun, atau{" "}
          <em>Instal PHP</em> selama belum ada yang terpasang, membuka daftar{" "}
          <strong>Versi PHP</strong>.
        </P>
        <H3>Versi</H3>
        <P>
          Zefaro menginstal build Windows resmi PHP 7.4 sampai 8.5 dari <C>downloads.php.net</C> dan
          memeriksa setiap unduhan dengan SHA-256 yang diterbitkan. Instal versi sebanyak yang Anda
          mau. <em>Aktifkan</em> memilih versi yang dipakai baris perintah dan situs baru.{" "}
          <em>Perbarui ke x.y.z</em> muncul saat ada rilis patch yang lebih baru.
        </P>
        <H3>Pengaturan</H3>
        <P>
          Setiap versi punya halaman pengaturan sendiri: klik roda gigi di kolom <em>Opsi</em>.
          Saat Anda menyimpan, Zefaro menulis ulang <C>php.ini</C> versi itu dan memulai ulang proses
          PHP-nya, jadi perubahan langsung berlaku. Versi lain tetap memakai batasnya sendiri.
          Halaman ini juga menampilkan <C>php.ini</C> versi tersebut dan bisa membuka foldernya.
        </P>
        <Rows
          rows={[
            ["Ukuran unggahan maksimum", <>1 sampai 4096 MB. Zefaro menyetel <C>post_max_size</C> agar sesuai (tidak pernah di bawah 8 MB).</>],
            ["Batas memori", <>16 sampai 16384 MB, atau <C>-1</C> tanpa batas.</>],
            ["Batas variabel input", "100 sampai 1.000.000 field formulir dan parameter query per permintaan."],
          ]}
        />
        <H3>Perubahan php.ini Anda sendiri</H3>
        <P>
          Pengaturan setiap versi ada di{" "}
          <C>%USERPROFILE%\.config\zefaro\bin\php\&lt;versi&gt;\php.ini</C>. Zefaro hanya menulis ulang
          bagian di bawah baris <C>; ---- Managed by Zefaro …</C>, jadi apa pun yang Anda ubah di
          atasnya tetap bertahan saat pembaruan.
        </P>
        <H3>Ekstensi</H3>
        <P>
          Halaman pengaturan setiap versi menampilkan semua ekstensi yang dibawa build-nya,
          masing-masing dengan sakelar. Ekstensi berikut aktif secara bawaan: bz2, curl, exif,
          fileinfo, gd, gettext, intl, mbstring, mysqli, openssl, pdo_mysql, pdo_pgsql, pdo_sqlite,
          pgsql, sodium, sqlite3, xsl, zip, dan OPcache. Aktifkan yang lain sesuai kebutuhan
          proyek Anda, lalu klik <em>Simpan perubahan</em>: Zefaro menuliskannya ke{" "}
          <C>php.ini</C> versi itu dan memulai ulang PHP-nya.
        </P>
        <List
          items={[
            <>
              Setelah menyimpan, Zefaro menjalankan PHP untuk memeriksa apakah setiap ekstensi bisa
              dimuat. Ekstensi yang gagal menampilkan alasannya, sering kali DLL dari produk lain
              yang belum terpasang (misalnya Oracle Instant Client untuk <C>oci8</C>).
            </>,
            <>
              Ekstensi yang dimuat oleh baris Anda sendiri di atas penanda tetap seperti yang Anda
              atur; ubah di <C>php.ini</C>.
            </>,
            <>
              Untuk menambah ekstensi yang tidak dibawa build-nya (misalnya Xdebug), taruh DLL-nya di
              folder <C>ext</C> versi itu. Ekstensi itu lalu muncul di daftar.
            </>,
          ]}
        />
        <H3>Port dasar</H3>
        <P>
          Setiap versi yang terpasang menjalankan listener FastCGI sendiri di{" "}
          <em>port dasar + versi</em>. Dengan port dasar bawaan 9000, PHP 8.3 memakai 9083 dan PHP
          8.5 memakai 9085. Port dasar tampil di halaman pengaturan setiap versi, tetapi semua versi
          memakai nilai yang sama. Ubah hanya jika port tersebut bentrok dengan program lain
          (rentang yang diizinkan 1024 sampai 65000).
        </P>
        <H3>Composer dan Laravel installer</H3>
        <P>
          Instal keduanya dari daftar Versi PHP. Keduanya berjalan dengan versi PHP aktif dan
          menyimpan filenya di folder Composer milik Zefaro, terpisah dari Composer yang mungkin sudah
          Anda punya. Laravel installer butuh PHP 8.2 atau yang lebih baru.
        </P>
        <H3>php, composer, dan laravel di terminal</H3>
        <P>
          Klik <em>Tambahkan ke PATH</em> di kartu <em>Command line (PATH)</em> pada daftar Versi
          PHP, lalu buka terminal baru:
        </P>
        <CodeBlock label="Terminal" code={"php -v\ncomposer --version\nlaravel new my-app"} />
      </>
    ),
  },
  {
    id: "node",
    title: "Node.js",
    icon: "node-js",
    group: "Situs dan runtime",
    summary: "Instal versi Node.js dan pilih yang aktif.",
    body: () => (
      <>
        <P>
          Node.js punya kartu di <em>Layanan, Inti</em>. Node.js bukan layanan latar belakang, jadi
          tidak ada yang perlu dimulai. <em>Kelola versi</em> (atau roda gigi) membuka daftar{" "}
          <strong>Versi Node.js</strong>.
        </P>
        <List
          items={[
            <>
              Zefaro menawarkan jalur <strong>Current</strong> dan setiap jalur <strong>LTS</strong>{" "}
              yang masih mendapat pembaruan, berupa build Windows resmi dari <C>nodejs.org</C>. Zefaro
              memeriksa setiap unduhan dengan SHA-256 yang diterbitkan nodejs.org.
            </>,
            <>
              Instal sebanyak yang Anda mau. <em>Aktifkan</em> memilih versi yang dijalankan{" "}
              <C>node</C>, <C>npm</C>, <C>npx</C>, dan <C>corepack</C>, dan versi pertama yang Anda
              instal menjadi aktif. <em>Perbarui</em> muncul saat sebuah jalur punya rilis yang
              lebih baru.
            </>,
            <>
              Ikon tempat sampah mencopot sebuah versi. Paket yang Anda instal dengan{" "}
              <C>npm install -g</C> ada di <C>%APPDATA%\npm</C> dan tetap tersimpan.
            </>,
          ]}
        />
        <P>
          Setelah <em>Tambahkan ke PATH</em> (folder yang sama dengan perintah PHP), pakai
          perintahnya di terminal:
        </P>
        <CodeBlock label="Terminal" code={"node -v\nnpm install\nnpm run dev"} />
      </>
    ),
  },
  {
    id: "services",
    title: "Layanan",
    icon: "server",
    group: "Layanan",
    summary: "Program latar belakang yang dijalankan Zefaro, dan pengaturan nginx.",
    body: (go) => (
      <>
        <P>
          Zefaro menjalankan program-program ini di latar belakang. Semuanya hanya mendengarkan di
          127.0.0.1.
          <GoTo page="services" label="Buka Layanan" go={go} />
        </P>
        <Rows
          rows={[
            ["nginx  ·  port 80", "Server web di depan setiap situs."],
            ["PHP x.y  ·  9000 + versi", "Satu listener FastCGI untuk setiap versi PHP yang terpasang."],
            ["DNS  ·  port 53 (UDP)", <>Menjawab pencarian <C>*.test</C> dengan alamat komputer ini.</>],
            ["MariaDB  ·  port 3306", "Server database yang kompatibel dengan MySQL."],
            ["Redis  ·  port 6379", "Cache, antrean, dan sesi."],
            ["phpMyAdmin", <>GUI database di <C>http://phpmyadmin.test</C>.</>],
            ["Mailpit  ·  1025 dan 8025", "Menangkap email keluar (SMTP di 1025, antarmuka web di 8025)."],
          ]}
        />
        <H3>Status</H3>
        <Rows
          rows={[
            ["Berjalan", "Layanan menjawab di port-nya."],
            ["Memulai", "Prosesnya sudah jalan tetapi belum menjawab."],
            ["Gagal", <>Layanan gagal dan kartunya menunjukkan alasannya. Klik <em>Coba lagi</em>.</>],
            ["Berhenti", "Layanan tidak berjalan."],
          ]}
        />
        <P>
          Jika sebuah layanan crash, Zefaro memulainya ulang. Setelah tiga kali crash dalam satu
          menit, Zefaro membiarkannya berhenti dan menampilkan error-nya.
        </P>
        <H3>Menutup jendela</H3>
        <P>
          Tombol tutup menyembunyikan Zefaro di system tray, dan layanan Anda tetap berjalan. Klik
          ikon Zefaro di tray untuk membukanya lagi. Untuk menghentikan semuanya, klik kanan ikon itu
          lalu pilih <em>Keluar dari Zefaro dan hentikan layanan</em>: Zefaro menghentikan setiap
          layanan secara berurutan, server web lebih dulu dan database terakhir. Saat pertama kali
          Anda menutup jendela, Zefaro menanyakan pilihan Anda; ubah kemudian di Pengaturan, bagian{" "}
          <em>Menutup jendela</em>.
        </P>
        <P>
          Zefaro hanya berjalan satu salinan. Membukanya lagi dari menu Start akan menampilkan
          jendela yang sudah berjalan.
        </P>
        <H3>Pengaturan nginx</H3>
        <P>
          Roda gigi di kartu nginx membuka pengaturannya. Saat Anda menyimpan, Zefaro lebih dulu
          memeriksa konfigurasi baru dengan nginx dan membuang apa pun yang gagal. nginx yang sedang
          berjalan memuat ulang konfigurasinya, atau dimulai ulang jika ada port yang berubah.
        </P>
        <List
          items={[
            <>
              <strong>Port HTTP dan HTTPS</strong> (80 dan 443). Setiap kolom menunjukkan apakah
              port itu bebas atau program mana yang memakainya. Dengan port lain, situs terbuka di
              alamat seperti <C>http://name.test:8080</C> dan <C>https://name.test:8443</C>.
            </>,
            <>
              <strong>Batas waktu PHP</strong> (300 detik). Naikkan saat Anda menelusuri kode
              langkah demi langkah dengan Xdebug.
            </>,
            <>
              <strong>Ukuran permintaan maksimum</strong> (tanpa batas secara default; batas
              unggahan PHP tetap berlaku).
            </>,
            <>
              <strong>Worker</strong>, <strong>keep-alive</strong>, <strong>gzip</strong>,{" "}
              <strong>HTTP/2</strong>, <strong>log akses</strong>, dan{" "}
              <strong>level log error</strong>.
            </>,
            <>
              <strong>Direktif tambahan</strong> untuk blok <C>http {"{ }"}</C> milik nginx, dan
              tampilan baca-saja dari <C>nginx.conf</C> yang dihasilkan.
            </>,
          ]}
        />
        <P>
          Di terminal, <C>nginx -t</C> memeriksa konfigurasi yang dihasilkan Zefaro, <C>nginx -T</C>{" "}
          mencetaknya, <C>nginx -v</C> menampilkan versinya, dan <C>nginx -s reload</C> memuat
          ulang konfigurasinya. Anda memulai dan menghentikan nginx di halaman Layanan, jadi salinan
          kedua tidak bisa merebut port-nya.
        </P>
        <P>
          Saat sebuah layanan bermasalah, log-nya biasanya menjelaskan sebabnya. Buka halaman Log
          untuk membacanya.
        </P>
      </>
    ),
  },
  {
    id: "dns",
    title: "DNS (.test)",
    icon: "shield-halved",
    group: "Layanan",
    summary: "Cara nama .test sampai ke Zefaro, dan apa yang perlu dicek saat tidak berhasil.",
    body: () => (
      <>
        <P>
          Zefaro menjalankan server DNS kecil yang menjawab setiap nama berakhiran <C>.test</C> dengan{" "}
          <C>127.0.0.1</C>. Sebuah aturan Windows hanya mengirim pencarian <C>.test</C> ke server
          itu, jadi situs web lain tetap di-resolve seperti biasa. Situs dan subdomain baru langsung
          berfungsi, tanpa perlu mengedit file hosts.
        </P>
        <Steps
          items={[
            <>
              Di halaman Layanan, klik <em>Mulai</em> pada kartu <strong>DNS</strong>. Selama
              Windows belum mengirim pencarian <C>.test</C> ke Zefaro, tombol ini membuka pengaturan
              DNS.
            </>,
            <>Klik <em>Pasang aturan</em> dan setujui permintaan Windows.</>,
            <>Zefaro memulai DNS dan memberi tahu Anda saat Windows sudah me-resolve nama <C>.test</C> melaluinya.</>,
          ]}
        />
        <P>
          <em>Hapus aturan</em> di pengaturan DNS menghapus aturan Windows itu lagi. Untuk itu pun
          Windows meminta hak admin.
        </P>
        <H3>Pengaturan DNS</H3>
        <P>Roda gigi di kartu DNS membuka pengaturannya:</P>
        <Rows
          rows={[
            ["Status", <>Server DNS dan aturan Windows, dengan <em>Pasang aturan</em> dan <em>Hapus aturan</em>.</>],
            ["Uji resolusi", "Mencari sebuah nama lewat server Zefaro dan lewat Windows, lalu memberi tahu bagian mana yang tidak berfungsi."],
            ["Kosongkan cache", "Mengosongkan cache DNS Windows. Tidak perlu hak admin."],
            [
              "Domain lokal",
              <>
                <C>.test</C> (bawaan) atau <C>.internal</C>. Keduanya dicadangkan, jadi tidak ada
                yang menutupi situs web sungguhan. Mengganti domain akan mengganti nama setiap situs
                (misalnya menjadi <C>my-app.internal</C>), memindahkan aturan Windows (satu
                permintaan hak admin), dan memberi situs yang diamankan sertifikat dari otoritas
                baru, yang perlu Anda percayai lagi.
              </>,
            ],
          ]}
        />
        <Note title="Jika nama .test tidak bisa dibuka" warn>
          VPN bisa mengambil alih DNS, dan secure DNS milik browser dengan penyedia khusus melewati
          Windows. Putuskan VPN atau setel secure DNS browser agar memakai penyedia Anda saat ini,
          lalu coba lagi.
        </Note>
        <CodeBlock label="PowerShell: cek resolusi" code={"Resolve-DnsName my-app.test"} />
      </>
    ),
  },
  {
    id: "databases",
    title: "Database",
    icon: "database",
    group: "Layanan",
    summary: "MariaDB, PostgreSQL, Redis, phpMyAdmin, serta ekspor dan impor dump besar.",
    body: () => (
      <>
        <H3>MariaDB</H3>
        <P>
          MariaDB 11.8 LTS mendengarkan di <C>127.0.0.1:3306</C> dengan user <C>root</C> tanpa
          password, sesuai yang diharapkan aplikasi Laravel baru. Saat pertama dimulai, Zefaro
          mengunduhnya (93 MB) dan membuat folder data. Zefaro mematikannya dengan rapi saat Anda
          menghentikannya atau keluar dari Zefaro.
        </P>
        <H3>PostgreSQL</H3>
        <P>
          PostgreSQL 18 mendengarkan di <C>127.0.0.1:5432</C> dengan pengguna <C>root</C> tanpa
          kata sandi, login yang dipakai <C>.env</C> Laravel sejak awal. Isi{" "}
          <C>DB_CONNECTION=pgsql</C> dan <C>DB_PORT=5432</C>. Saat pertama dimulai, Zefaro
          mengunduhnya (328 MB; yang disimpan hanya server dan alatnya, tanpa pgAdmin) lalu
          membuat folder data, dalam UTF-8 dengan locale C. Zefaro menghentikannya dengan fast
          shutdown, jadi mulai berikutnya tidak perlu pemulihan. Di terminal, <C>psql</C>,{" "}
          <C>pg_dump</C>, <C>pg_restore</C>, <C>createdb</C>, dan <C>dropdb</C> langsung
          tersambung tanpa opsi. Wizard <strong>Situs baru</strong> bisa membuat aplikasi di atasnya,
          dan tab Data serta Tinker di halaman situs bekerja dengannya seperti dengan MariaDB.
        </P>
        <H3>Redis</H3>
        <P>
          Redis 8 mendengarkan di <C>127.0.0.1:6379</C> tanpa password dan menyimpan datanya ke
          disk, jadi data tetap ada setelah dimulai ulang.
        </P>
        <H3>phpMyAdmin</H3>
        <P>
          Buka <C>http://phpmyadmin.test</C>. phpMyAdmin langsung memasukkan Anda sebagai root.
          Memulai phpMyAdmin juga memulai MariaDB, PHP, dan nginx; menghentikannya hanya membuat
          situs phpMyAdmin offline.
        </P>
        <H3>Ekspor dan impor berukuran berapa pun</H3>
        <P>
          Roda gigi di kartu MariaDB membuka halaman <strong>Database</strong>. Halaman ini
          mencantumkan setiap database beserta ukurannya, dengan <em>Database baru</em>,{" "}
          <em>Ekspor</em>, <em>Impor dump…</em>, dan <em>Hapus</em>. Zefaro mengalirkan data antara
          MariaDB dan file, jadi dump 5 GB atau lebih tetap bisa diproses tanpa kehabisan memori.
          Lewat unggahan ke phpMyAdmin, dump sebesar itu tidak bisa.
        </P>
        <List
          items={[
            <>
              <strong>Ekspor</strong> menulis <C>.sql.gz</C> (disarankan, biasanya jauh lebih
              kecil) atau <C>.sql</C> biasa, termasuk view, routine, trigger, dan event. Zefaro membaca
              snapshot yang konsisten, jadi aplikasi Anda tetap bisa memakai database selama ekspor
              berjalan.
            </>,
            <>
              <strong>Impor</strong> menerima dump <C>.sql</C> atau dump ber-gzip dari Zefaro,
              mariadb-dump, mysqldump, atau phpMyAdmin. Dump dimuat ke database baru, atau
              menggantikan database yang sudah ada setelah Zefaro meminta konfirmasi Anda. Zefaro
              melewati pemeriksaan foreign key dan unique selama pemuatan, sehingga impor besar jauh
              lebih cepat.
            </>,
            <>
              <strong>Dump berisi beberapa database</strong> (dibuat dengan{" "}
              <C>mysqldump --all-databases</C> atau <C>--databases</C>, seperti cadangan Laragon)
              memuat satu bagian per database. Zefaro membaca file itu lebih dulu dan menampilkan
              daftarnya; Anda memilih satu, dan hanya bagian itu yang dimuat, ke database yang Anda
              namai. Zefaro tidak pernah mengimpor database sistem milik MariaDB seperti <C>mysql</C>.
            </>,
            <>
              Zefaro tidak pernah menjalankan baris <C>CREATE DATABASE</C>, <C>USE</C>, atau{" "}
              <C>SET GLOBAL</C> dari sebuah dump, jadi impor tidak bisa menulis di luar database
              yang Anda pilih atau mengubah pengaturan seluruh server.
            </>,
            <>
              Dump dari MySQL 8 bisa diimpor apa adanya: MariaDB 11.8 milik Zefaro mengenali
              collation MySQL 8, seperti <C>utf8mb4_0900_ai_ci</C>.
            </>,
            <>
              Bilah progres menunjukkan ukuran, kecepatan, dan sisa waktu. Anda bisa meninggalkan
              halaman lalu kembali, atau klik <em>Batal</em>; ekspor yang dibatalkan tidak
              meninggalkan file setengah jadi. Jika MariaDB menolak sebuah statement, Zefaro
              menampilkan pesan MariaDB sendiri beserta nomor barisnya.
            </>,
            <>
              Lamanya terutama bergantung pada disk Anda: SSD mengimpor beberapa kali lebih cepat
              daripada hard disk. Database biasanya memakan ruang disk lebih besar daripada dump-nya
              karena indeks.
            </>,
          ]}
        />
        <Note title="Disetel untuk dump besar">
          MariaDB milik Zefaro menerima paket hingga 1 GB (baris besar dan INSERT panjang) dan
          menulis log-nya ke disk sekitar sekali per detik, bukan pada setiap commit. Hasilnya,
          impor berjalan jauh lebih cepat. Jika listrik padam, tulisan dari detik terakhir bisa
          hilang: tidak masalah untuk pengembangan lokal, tetapi bukan pengaturan untuk server
          produksi.
        </Note>
        <H3>Dari terminal</H3>
        <P>
          Dengan folder Zefaro di PATH (<em>Tambahkan ke PATH</em>), tool MariaDB <C>mariadb</C>,{" "}
          <C>mysql</C>, <C>mariadb-dump</C>, <C>mysqldump</C>, dan <C>mariadb-admin</C> terhubung
          ke MariaDB milik Zefaro sebagai root secara default, dan <C>redis-cli</C> terhubung ke
          Redis milik Zefaro. Opsi yang Anda tambahkan sendiri (seperti <C>-u</C> atau <C>-h</C>)
          lebih diutamakan.
        </P>
        <CodeBlock
          label="Terminal"
          code={"mariadb -e \"CREATE DATABASE my_app\"\nmariadb-dump my_app > my_app.sql\nredis-cli ping"}
        />
        <H3>Laravel .env</H3>
        <CodeBlock label=".env" code={LARAVEL_ENV} />
        <P>
          Di Laravel 10 atau yang lebih lama, pakai <C>DB_CONNECTION=mysql</C>.
        </P>
        <Note title="Hanya untuk pengembangan lokal">
          Akun root tanpa password tidak masalah di sini karena MariaDB hanya menerima koneksi dari
          komputer ini. Jangan pernah menyalin pengaturan ini ke server.
        </Note>
      </>
    ),
  },
  {
    id: "mail",
    title: "Email",
    icon: "envelope",
    group: "Layanan",
    summary: "Tangkap email keluar dengan Mailpit dan baca di Zefaro.",
    body: (go) => (
      <>
        <P>
          Zefaro menjalankan <strong>Mailpit</strong>, penangkap email. Setiap email yang dikirim
          aplikasi Anda masuk ke halaman Email di Zefaro, bukan ke kotak masuk sungguhan, jadi email
          reset password, invoice, dan newsletter tidak pernah sampai ke orang sungguhan selama Anda
          mengembangkan aplikasi.
          <GoTo page="mail" label="Buka Email" go={go} />
        </P>
        <Steps
          items={[
            <>
              Mulai <strong>Mailpit</strong> di halaman Layanan, atau klik{" "}
              <em>Instal dan mulai Mailpit</em> di halaman Email. Zefaro mengunduh Mailpit saat
              pertama kali (sekitar 11 MB).
            </>,
            <>
              Arahkan aplikasi Anda ke host SMTP <C>127.0.0.1</C>, port <C>1025</C>. Mailpit
              menerima username dan password apa pun, tanpa enkripsi.
            </>,
            <>Kirim email. Email itu muncul di halaman Email dalam beberapa detik.</>,
          ]}
        />
        <CodeBlock
          label="Laravel .env"
          code={"MAIL_MAILER=smtp\nMAIL_HOST=127.0.0.1\nMAIL_PORT=1025\nMAIL_USERNAME=null\nMAIL_PASSWORD=null\nMAIL_ENCRYPTION=null"}
        />
        <P>
          Fungsi <C>mail()</C> bawaan PHP langsung berfungsi tanpa pengaturan: Zefaro mengarahkan{" "}
          <C>SMTP</C> dan <C>smtp_port</C> di <C>php.ini</C> setiap versi ke Mailpit.
        </P>
        <H3>Halaman Email</H3>
        <List
          items={[
            <>
              Kotak masuk ada di kiri (pesan yang belum dibaca dicetak tebal) dan pesan yang dipilih
              di kanan. Email baru muncul tanpa perlu dimuat ulang, dan sidebar menampilkan jumlah
              pesan yang belum dibaca.
            </>,
            <>
              Cari dengan sintaks Mailpit, misalnya <C>from:shop</C>, <C>subject:"order"</C>,{" "}
              <C>is:unread</C>, atau <C>has:attachment</C>.
            </>,
            <>
              Tab menampilkan HTML, teks biasa, header, dan source lengkap. Pratinjau HTML tidak
              menjalankan skrip. Zefaro mencantumkan tautan dalam email di atasnya dan membukanya di
              browser Anda, yang berguna untuk tautan reset password dan verifikasi. Lampiran bisa
              dibuka atau disimpan dengan satu klik.
            </>,
            <>
              <em>Tandai belum dibaca</em>, <em>Hapus pesan</em>, <em>Tandai semua dibaca</em>,{" "}
              dan <em>Hapus semua</em> mengelola kotak masuk. <em>Buka Mailpit</em> menampilkan
              antarmuka Mailpit sendiri (juga di <C>http://mailpit.test</C>), dengan pemeriksaan
              kompatibilitas HTML, tautan, dan spam.
            </>,
          ]}
        />
        <H3>Pengaturan</H3>
        <P>
          Roda gigi di kartu Mailpit, atau di halaman Email, mengatur port SMTP (1025), port
          antarmuka web (8025), jumlah pesan yang disimpan (1.000), dan usia maksimum yang opsional.
          Mailpit menyimpan email di <C>%USERPROFILE%\.config\zefaro\data\mailpit</C>, jadi email
          tetap ada setelah dimulai ulang. Kedua port hanya mendengarkan di <C>127.0.0.1</C>, dan
          Mailpit tidak pernah mengirim email ke mana pun.
        </P>
      </>
    ),
  },
  {
    id: "logs",
    title: "Log",
    icon: "file-lines",
    group: "Referensi",
    summary: "Baca, saring, dan cari log setiap layanan.",
    body: (go) => (
      <>
        <P>
          Halaman Log menampilkan apa yang ditulis setiap layanan, dibaca langsung dari file log-nya
          di <C>%USERPROFILE%\.config\zefaro\logs</C>.
          <GoTo page="logs" label="Buka Log" go={go} />
        </P>
        <Rows
          rows={[
            ["Error server web", <>Error nginx, ditambah error dan peringatan PHP dari situs Anda (<C>nginx-error.log</C>).</>],
            ["Permintaan", <>Setiap permintaan dengan metode, path, status, situs, ukuran, dan waktunya (<C>nginx-access.log</C>).</>],
            ["PHP <versi>", <>Apa yang dicetak php-cgi sendiri, seperti masalah saat dimulai (<C>php-&lt;versi&gt;.log</C>).</>],
            ["MariaDB, PostgreSQL, Redis", <>Server database (<C>mariadb.log</C>, <C>postgresql.log</C>, <C>redis.log</C>).</>],
            ["DNS, output nginx", <>Name server <C>.test</C> milik Zefaro dan konsol nginx (<C>dns.log</C>, <C>nginx-stdout.log</C>).</>],
          ]}
        />
        <List
          items={[
            <>
              <strong>Live</strong> mengikuti file saat bertambah dan menjaga baris terbaru tetap
              terlihat. Gulir ke atas untuk membaca, lalu klik <em>Gulir ke yang terbaru</em> untuk
              kembali. <em>Dijeda</em> menghentikan pembaruan.
            </>,
            <>
              Saring dengan <em>Peringatan</em> atau <em>Error</em>, atau cari. Klik sebuah baris
              untuk melihatnya persis seperti yang ditulis layanan, lalu salin.
            </>,
            <>
              Halaman ini menampilkan 1.000 baris terakhir. <em>Buka folder log</em> menampilkan
              semua file di File Explorer. Ikon tempat sampah mengosongkan log yang dipilih, dan
              layanan tetap menulis ke file itu.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "files",
    title: "File dan folder",
    icon: "folder-tree",
    group: "Referensi",
    summary: "Tempat Zefaro menyimpan program, pengaturan, dan data.",
    body: () => (
      <>
        <P>
          Semua yang diinstal atau dibuat Zefaro ada di bawah <C>%USERPROFILE%\.config\zefaro</C>:
        </P>
        <Rows
          rows={[
            ["config.json", <>Situs dan pengaturan Anda. Jika program lain sedang membukanya, Zefaro menyimpan begitu file itu ditutup. File yang bukan JSON valid disimpan sebagai <C>config.broken-*.json</C> sebelum Zefaro mulai lagi dengan pengaturan bawaan.</>],
            ["ca-bundle.pem", "Sertifikat yang dipercaya PHP untuk HTTPS: daftar Mozilla ditambah CA Zefaro."],
            ["bin\\", <>Shim perintah seperti <C>php.bat</C>, <C>composer.bat</C>, dan <C>laravel.bat</C>. <em>Tambahkan ke PATH</em> menambahkan folder ini.</>],
            ["bin\\php\\<versi>\\", "Satu folder per versi PHP, beserta php.ini-nya."],
            ["bin\\nginx, mariadb, redis", "Program yang sudah diunduh."],
            ["nginx\\", "Konfigurasi server web yang dihasilkan: nginx.conf dan satu file per situs."],
            ["data\\mariadb\\", "Database Anda."],
            ["data\\mailpit\\", "Email yang ditangkap Mailpit."],
            ["redis\\", "Konfigurasi Redis dan data yang disimpannya."],
            ["apps\\phpmyadmin\\", "phpMyAdmin."],
            ["composer\\", "Folder home Composer milik Zefaro, dengan paket global seperti Laravel installer."],
            ["certs\\", "Otoritas sertifikat Zefaro (kuncinya dienkripsi untuk akun Windows Anda) dan satu sertifikat per situs yang diamankan."],
            ["runtime\\", "Skrip bantu PHP milik Zefaro untuk alat situs."],
            ["logs\\", "Log layanan, yang ditampilkan di halaman Log."],
            ["downloads\\", "Unduhan sementara, yang dihapus Zefaro setelah instalasi selesai."],
          ]}
        />
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Pemecahan masalah",
    icon: "triangle-exclamation",
    group: "Referensi",
    summary: "Error yang umum dan cara memperbaikinya.",
    body: () => (
      <>
        <H3>Port 80 dipakai Windows (PID 4)</H3>
        <P>
          IIS atau layanan web Windows lain memakai port 80. Hentikan{" "}
          <em>World Wide Web Publishing Service</em> di <C>services.msc</C>, atau jalankan perintah
          di bawah ini di terminal administrator, lalu mulai nginx lagi.
        </P>
        <CodeBlock label="Terminal administrator" code={"net stop w3svc"} />
        <H3>Port … sudah dipakai oleh …</H3>
        <P>
          Program lain memakai port itu, sering kali Apache (<C>httpd</C>), XAMPP, Laragon, Skype,
          atau server database kedua. Pesannya menyebut nama program itu: hentikan program tersebut
          lalu klik <em>Coba lagi</em>. Anda juga bisa memindahkan Zefaro. Untuk nginx, buka
          pengaturannya lewat roda gigi dan pilih port yang bebas seperti 8080; untuk PHP, ganti
          port dasar.
        </P>
        <H3>nginx tidak bisa dimulai karena port 443 sedang dipakai</H3>
        <P>
          Situs yang diamankan butuh port 443 selain port 80. Server web lokal lain (XAMPP,
          Laragon, IIS) atau program seperti Skype atau VMware mungkin memakainya. Tutup
          program itu lalu klik <em>Coba lagi</em>, atau setel port HTTPS lain (seperti 8443) di
          pengaturan nginx.
        </P>
        <H3>Browser menyebut koneksi tidak bersifat pribadi</H3>
        <P>
          Percayai otoritas sertifikat Zefaro (<em>Percayai sertifikat…</em> di Pengaturan, bagian
          HTTPS), lalu mulai ulang browser. Jika masih muncul peringatan, pastikan alamatnya adalah
          nama <C>.test</C> yang tampil di halaman Situs.
        </P>
        <H3>PHP terinstal tetapi tidak mau berjalan</H3>
        <P>
          Instal Microsoft Visual C++ Redistributable (x64) dari{" "}
          <C>aka.ms/vs/17/release/vc_redist.x64.exe</C>.
        </P>
        <H3>Situs menampilkan 502 Bad Gateway</H3>
        <P>
          Versi PHP situs itu tidak berjalan. Mulai versi itu di halaman Layanan, atau klik{" "}
          <em>Mulai semua</em>.
        </P>
        <H3>Situs menampilkan halaman bawaan Zefaro</H3>
        <P>
          nginx tidak mengenal nama itu. Bandingkan ejaannya dengan halaman Situs: nama ditulis
          dengan huruf kecil dan tanda hubung.
        </P>
        <H3>Mulai dari awal</H3>
        <Steps
          items={[
            <>
              Copot Zefaro. Uninstaller juga menghapus entri PATH-nya, aturan DNS, dan sertifikat yang
              dipercaya. Untuk melakukannya tanpa mencopot, hentikan semua layanan, klik{" "}
              <em>Hapus aturan</em> di pengaturan DNS, klik <em>Hapus kepercayaan…</em> di
              Pengaturan, lalu hapus <C>…\.config\zefaro\bin</C> di{" "}
              <em>Edit variabel lingkungan untuk akun Anda</em>.
            </>,
            <>
              Hapus <C>%USERPROFILE%\.config\zefaro</C>. <strong>Ini juga menghapus database
              Anda.</strong>
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "faq",
    title: "Tanya jawab",
    icon: "circle-question",
    group: "Referensi",
    summary: "Jawaban singkat untuk pertanyaan umum.",
    body: () => <FaqList items={FAQ} />,
  },
];
