// Guide pages in Indonesian, one per search topic: moving from XAMPP, moving from Laragon,
// and what an IT student needs. They are prerendered like the home page.
//
// Keep every claim checkable. About other tools, say only what is plainly true of them; say
// what Zefaro does rather than what they lack.

export type GuideId = "alternatif-xampp" | "alternatif-laragon" | "aplikasi-mahasiswa-it";

export type Block =
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { table: { head: string[]; rows: string[][] } };

export type Guide = {
  id: GuideId;
  path: string;
  /** <title>, up to about 60 characters. */
  title: string;
  /** Meta description, up to about 155 characters. */
  description: string;
  /** Short name for links and breadcrumbs. */
  label: string;
  h1: string;
  lead: string;
  sections: { h2: string; blocks: Block[] }[];
  faq: { q: string; a: string }[];
};

export const GUIDE_UPDATED = "2026-10-29";

export const guides: Guide[] = [
  {
    id: "alternatif-xampp",
    path: "/id/alternatif-xampp/",
    title: "Alternatif XAMPP Gratis untuk Windows: Zefaro",
    description:
      "Alternatif XAMPP untuk belajar PHP dan Laravel: Zefaro gratis, open source, menjalankan beberapa versi PHP, dan membuka proyek di nama.test.",
    label: "Alternatif XAMPP",
    h1: "Alternatif XAMPP yang ringan untuk belajar PHP dan Laravel",
    lead:
      "XAMPP adalah cara klasik menjalankan PHP di komputer sendiri. Kalau Anda butuh beberapa versi PHP, alamat proyek yang rapi, HTTPS, atau alat khusus Laravel, Zefaro bisa menjadi penggantinya. Gratis, open source, dan proyek di htdocs bisa dipakai tanpa dipindah.",
    sections: [
      {
        h2: "Kenapa mencari alternatif XAMPP",
        blocks: [
          {
            p: "XAMPP membawa Apache, MariaDB, PHP, dan phpMyAdmin dalam satu paket. Setiap rilis XAMPP berisi satu versi PHP, dan proyek dibuka lewat alamat seperti localhost/nama-folder. Untuk tugas sederhana itu sudah cukup.",
          },
          {
            p: "Masalah biasanya muncul saat proyek makin banyak. Satu tugas butuh PHP 7.4, proyek Laravel terbaru butuh PHP 8.2 ke atas. Virtual host dan HTTPS harus diatur sendiri di file konfigurasi. Pesan error Laravel juga sering mengarah ke .env atau migrasi yang belum jalan.",
          },
        ],
      },
      {
        h2: "XAMPP dan Zefaro, berdampingan",
        blocks: [
          {
            table: {
              head: ["", "XAMPP", "Zefaro"],
              rows: [
                ["Versi PHP", "Satu versi per instalasi", "7.4 sampai 8.5 berdampingan, dipilih per situs"],
                ["Web server", "Apache", "nginx"],
                ["Alamat proyek", "localhost/nama-folder", "nama.test, termasuk subdomain"],
                ["HTTPS", "Diatur sendiri", "Satu klik per situs, dari CA lokal Zefaro"],
                ["Database", "MariaDB, phpMyAdmin", "MariaDB, PostgreSQL, Redis, phpMyAdmin"],
                ["Email uji", "Mercury Mail, perlu diatur", "Mailpit menangkap semua email aplikasi"],
                ["Alat Laravel", "Tidak ada", "Tinker, Artisan, data, log, worker, perbaikan .env"],
              ],
            },
          },
        ],
      },
      {
        h2: "Pindah dari XAMPP ke Zefaro",
        blocks: [
          {
            steps: [
              "Unduh installer Zefaro dari halaman rilis GitHub lalu jalankan. Tidak perlu hak administrator.",
              "Di halaman Layanan, pasang versi PHP yang Anda butuhkan.",
              "Di halaman Situs, pilih Impor dari XAMPP atau Laragon. Zefaro menemukan folder htdocs dan menautkan proyek yang Anda pilih di tempatnya, tanpa memindahkan file.",
              "Untuk database, jalankan MySQL di XAMPP lalu klik Salin keluar. Setelah itu hentikan MySQL XAMPP, mulai MariaDB milik Zefaro, dan klik Muat ke Zefaro.",
              "Buka proyek di alamat nama-proyek.test.",
            ],
          },
          {
            p: "XAMPP boleh tetap terpasang. Yang penting, keduanya tidak dijalankan bersamaan, karena sama-sama memakai port 80 dan 3306. Halaman Pemeriksa di Zefaro menyebutkan program mana yang sedang memakai port tersebut.",
          },
        ],
      },
      {
        h2: "Cocok untuk siapa",
        blocks: [
          {
            list: [
              "Mahasiswa yang mengerjakan tugas PHP dan Laravel dengan versi PHP berbeda.",
              "Developer Laravel yang ingin Tinker, Artisan, dan log dalam satu jendela.",
              "Pengguna Windows 10 dan 11 yang ingin alat ringan tanpa akun, tanpa fitur AI, dan tanpa cloud.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Apakah proyek di htdocs harus dipindah?",
        a: "Tidak. Zefaro menautkan folder di tempatnya. Proyek di C:\\xampp\\htdocs tetap di sana dan dibuka di nama-proyek.test.",
      },
      {
        q: "Apakah database XAMPP bisa ikut pindah?",
        a: "Bisa. Fitur impor menyalin database dari MySQL XAMPP (sebagai root tanpa password, bawaan XAMPP) lalu memuatnya ke MariaDB milik Zefaro.",
      },
      {
        q: "Apakah Zefaro bisa menjalankan proyek PHP biasa, bukan Laravel?",
        a: "Bisa. Zefaro menyajikan folder PHP apa pun, termasuk WordPress dan proyek PHP tanpa framework.",
      },
      {
        q: "Berapa biayanya?",
        a: "Gratis. Zefaro open source dengan lisensi MIT dan tidak butuh akun.",
      },
    ],
  },
  {
    id: "alternatif-laragon",
    path: "/id/alternatif-laragon/",
    title: "Alternatif Laragon Gratis dan Open Source: Zefaro",
    description:
      "Zefaro adalah alternatif Laragon yang gratis dan open source untuk Windows: situs di nama.test, HTTPS satu klik, beberapa versi PHP, dan alat khusus Laravel.",
    label: "Alternatif Laragon",
    h1: "Alternatif Laragon yang gratis, open source, dan fokus ke Laravel",
    lead:
      "Laragon populer karena praktis: proyek langsung punya alamat .test. Zefaro bekerja dengan cara serupa, lalu menambahkan alat untuk Laravel di dalam aplikasinya. Gratis, open source, dan folder www Laragon bisa langsung ditautkan.",
    sections: [
      {
        h2: "Yang sama dengan Laragon",
        blocks: [
          {
            list: [
              "Setiap folder proyek dibuka di alamat nama.test.",
              "HTTPS untuk situs lokal dengan sekali klik.",
              "MariaDB, PostgreSQL, dan Redis siap dipakai.",
              "Berjalan di Windows.",
            ],
          },
        ],
      },
      {
        h2: "Yang ada di Zefaro",
        blocks: [
          {
            list: [
              "Open source dengan lisensi MIT. Kodenya bisa dibaca dan dikembangkan siapa saja di GitHub.",
              "Versi PHP 7.4 sampai 8.5 terpasang berdampingan, dan setiap situs memilih versinya sendiri.",
              "Halaman khusus untuk setiap aplikasi Laravel: ringkasan kondisi aplikasi, penjelajah data, .env, route, log, Tinker yang menyimpan variabel, dan perintah Artisan dalam bentuk formulir.",
              "Penampung dump: hasil dump() dan dd() tampil di Zefaro, lengkap dengan file dan barisnya.",
              "Xdebug sekali klik untuk setiap versi PHP.",
              "Mailpit untuk menangkap email aplikasi, dan file zefaro.json agar satu tim memakai pengaturan yang sama.",
              "Tanpa akun, tanpa fitur AI, dan tanpa cloud.",
            ],
          },
        ],
      },
      {
        h2: "Pindah dari Laragon ke Zefaro",
        blocks: [
          {
            steps: [
              "Pasang Zefaro dari halaman rilis GitHub.",
              "Pasang versi PHP yang dibutuhkan proyek Anda di halaman Layanan.",
              "Hentikan Laragon (Stop All), karena keduanya memakai port 80, 443, dan 3306.",
              "Di halaman Situs, pilih Impor dari XAMPP atau Laragon. Zefaro menemukan C:\\laragon\\www dan menautkan proyek pilihan Anda di tempatnya.",
              "Salin database dari MySQL Laragon ke MariaDB milik Zefaro lewat bagian Database di halaman impor.",
            ],
          },
          {
            p: "Karena nama alamatnya sama-sama .test, URL proyek Anda biasanya tidak berubah. APP_URL di .env diperbarui otomatis saat masih menunjuk ke localhost atau alamat .test.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Apakah Zefaro bisa dipakai bersamaan dengan Laragon?",
        a: "Boleh terpasang bersamaan, tetapi jangan dijalankan bersamaan karena memakai port yang sama. Hentikan salah satunya dulu.",
      },
      {
        q: "Apakah proyek di folder www harus dipindah?",
        a: "Tidak. Zefaro menautkan folder di tempatnya, termasuk proyek di C:\\laragon\\www.",
      },
      {
        q: "Apakah Zefaro hanya untuk Laravel?",
        a: "Tidak. Zefaro menyajikan folder PHP apa pun, termasuk WordPress, Symfony, dan PHP tanpa framework. Alat khusus Laravel muncul untuk proyek Laravel.",
      },
    ],
  },
  {
    id: "aplikasi-mahasiswa-it",
    path: "/id/aplikasi-mahasiswa-it/",
    title: "Aplikasi Gratis untuk Mahasiswa IT Belajar PHP: Zefaro",
    description:
      "Aplikasi gratis untuk mahasiswa IT yang belajar PHP, Laravel, dan database di Windows. Pasang sekali, buat proyek, dan kerjakan tugas di alamat nama.test.",
    label: "Aplikasi untuk mahasiswa IT",
    h1: "Aplikasi gratis untuk mahasiswa IT yang belajar PHP dan Laravel",
    lead:
      "Kuliah pemrograman web butuh web server, PHP, dan database di laptop sendiri. Zefaro menyiapkan semuanya dalam satu aplikasi kecil untuk Windows, gratis dan tanpa akun, supaya waktu Anda habis untuk belajar, bukan mengatur konfigurasi.",
    sections: [
      {
        h2: "Yang dibutuhkan untuk tugas pemrograman web",
        blocks: [
          {
            list: [
              "PHP, sering dengan versi berbeda untuk tiap mata kuliah atau proyek.",
              "Web server untuk membuka proyek di browser.",
              "Database MariaDB atau MySQL, plus phpMyAdmin untuk melihat isinya.",
              "Composer dan installer Laravel untuk proyek Laravel.",
              "Node.js untuk front end seperti Vite, React, atau Vue.",
            ],
          },
          {
            p: "Zefaro menyediakan semuanya. Installer-nya sekitar 3 MB, dan setiap komponen diunduh dari sumber resminya hanya saat Anda membutuhkannya.",
          },
        ],
      },
      {
        h2: "Mulai dalam empat langkah",
        blocks: [
          {
            steps: [
              "Unduh dan jalankan installer Zefaro. Tidak perlu hak administrator.",
              "Pasang versi PHP di halaman Layanan, lalu klik Mulai semua.",
              "Siapkan domain .test sekali. Windows meminta izin administrator satu kali.",
              "Buat situs baru (Laravel, WordPress, atau PHP biasa) atau tautkan folder tugas yang sudah ada.",
            ],
          },
        ],
      },
      {
        h2: "Membantu saat mengerjakan tugas",
        blocks: [
          {
            list: [
              "Beberapa versi PHP berdampingan, jadi tugas lama dan proyek baru bisa dibuka bergantian tanpa pasang ulang.",
              "Ekspor dan impor database untuk mengumpulkan tugas atau memindahkan proyek ke laptop teman.",
              "Pesan error Laravel yang umum, seperti app key kosong atau migrasi yang belum jalan, bisa diperbaiki dengan satu tombol.",
              "Tinker dan perintah Artisan bisa dijalankan dari jendela Zefaro, lengkap dengan formulirnya.",
              "File zefaro.json membuat anggota kelompok memakai versi PHP, database, dan pengaturan yang sama.",
              "Halaman Pemeriksa menjelaskan kenapa sesuatu tidak jalan, misalnya port 80 dipakai program lain.",
            ],
          },
        ],
      },
      {
        h2: "Gratis dan aman untuk laptop kampus",
        blocks: [
          {
            p: "Zefaro open source dengan lisensi MIT. Tidak ada akun, tidak ada analitik, tidak ada fitur AI, dan tidak ada cloud. Semua layanan hanya mendengarkan di 127.0.0.1, jadi tidak bisa diakses dari jaringan kampus.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Apakah Zefaro bisa dipakai di Windows 10?",
        a: "Bisa. Zefaro berjalan di Windows 10 dan 11, 64-bit.",
      },
      {
        q: "Apakah perlu internet setelah terpasang?",
        a: "Internet dibutuhkan saat memasang PHP, database, atau alat lain pertama kali. Setelah itu proyek berjalan tanpa internet.",
      },
      {
        q: "Apakah bisa untuk proyek kelompok?",
        a: "Bisa. Simpan zefaro.json di folder proyek, lalu anggota kelompok yang menautkan folder itu mendapat pengaturan yang sama.",
      },
      {
        q: "Bagaimana kalau sebelumnya memakai XAMPP atau Laragon?",
        a: "Zefaro bisa mengimpor proyek dari htdocs atau www, dan menyalin database dari MySQL lama.",
      },
    ],
  },
];

export const guideByPath = (path: string) => guides.find((g) => g.path === path) ?? null;
