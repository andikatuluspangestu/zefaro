import { defineMessages } from "@/i18n";

type Job = (db: string) => string;
type JobTitles = { running: Job; done: Job; failed: Job; cancelled: Job };

export const messages = defineMessages({
  en: {
    duration: {
      hm: (h: number, m: number) => `${h}h ${m}m`,
      ms: (m: number, s: string) => `${m}m ${s}s`,
      s: (s: number) => `${s}s`,
    },
    formats: {
      compressed: {
        title: "Compressed",
        text: "Usually 2 to 10 times smaller. Slower to write; Zefaro imports it directly.",
      },
      plain: {
        title: "Plain SQL",
        text: "Fastest to write and opens in any editor, but makes the largest file.",
      },
    },
    job: {
      export: {
        running: (db) => `Exporting ${db}`,
        done: (db) => `Exported ${db}`,
        failed: (db) => `Export of ${db} failed`,
        cancelled: (db) => `Export of ${db} cancelled`,
      } as JobTitles,
      import: {
        running: (db) => `Importing into ${db}`,
        done: (db) => `Imported into ${db}`,
        failed: (db) => `Import of ${db} failed`,
        cancelled: (db) => `Import of ${db} cancelled`,
      } as JobTitles,
    },
    showInFolder: "Show in folder",
    dismiss: "Dismiss",
    exportDone: (file: string, sql: string) => `${file} file · ${sql} of SQL`,
    importDone: (read: string) => `${read} read`,
    progress: (done: string, total: string, exact: boolean) => `${done} ${exact ? "of" : "of about"} ${total}`,
    left: (d: string) => ` · about ${d} left`,
    created: (name: string) => `Created ${name}`,
    exportTitle: (name: string) => `Export ${name}`,
    compressedSql: "Compressed SQL",
    lowSpace: (free: string) => `Only ${free} free on that drive. The export may not fit.`,
    importInto: (name: string) => `Import into ${name}`,
    importADatabase: "Import a database",
    sqlDump: "SQL dump",
    dropped: (name: string) => `Dropped ${name}`,
    title: "Databases",
    description: (server: string, port: number) =>
      `${server} on 127.0.0.1:${port} · user root, no password. Export and import dumps of any size.`,
    servers: "Database server",
    importDump: "Import dump…",
    newDatabase: "New database",
    notRunningTitle: (server: string) => `${server} isn't running`,
    notRunningDescription: "Start it to list, export and import your databases.",
    notInstalledDescription: (server: string) =>
      `Zefaro downloads ${server} the first time it starts, then lists, exports and imports your databases here.`,
    start: (server: string) => `Start ${server}`,
    emptyTitle: "No databases yet",
    emptyDescription: "Create one, or import a .sql or .sql.gz dump.",
    colDatabase: "Database",
    colSize: "Size",
    colTables: "Tables",
    colActions: "Actions",
    exporting: "Exporting",
    importing: "Importing",
    export: "Export",
    exportTip: (name: string) => `Save a copy of ${name} to a file`,
    import: "Import",
    importTip: (name: string) => `Replace ${name} with a dump file`,
    drop: (name: string) => `Drop ${name}`,
    count: (n: number) => `${n} database${n === 1 ? "" : "s"}`,
    freeOnDrive: (free: string) => `${free} free on the data drive`,
    newDescription: (pg: boolean) =>
      `Use letters, digits, _ and -. Zefaro creates it as ${pg ? "UTF-8" : "utf8mb4"}.`,
    nameLabel: "Database name",
    createDatabase: "Create database",
    exportDialogBefore: "Export ",
    exportSize: (size: string, tables: number) => `${size} in ${tables} table${tables === 1 ? "" : "s"}. `,
    exportEmpty: "This database is empty. ",
    exportIncludes: (server: string, pg: boolean) =>
      pg
        ? `The export includes tables, views, functions, sequences and indexes, without ownership or grants. ${server} stays available while it runs.`
        : `The export includes views, routines, triggers and events. ${server} stays available while it runs.`,
    format: "Format",
    recommended: "Recommended",
    chooseWhere: "Choose where to save…",
    importFile: (file: string) => `Import ${file}`,
    importAccepts: (pg: boolean): string =>
      pg
        ? "Accepts pg_dump SQL (.sql or .sql.gz) and pg_dump's custom format. Ownership and grants are left out."
        : "Accepts plain .sql or gzip-compressed dumps from Zefaro, mariadb-dump, mysqldump or phpMyAdmin.",
    customFormat: "A pg_dump archive in its custom format. Zefaro loads it with pg_restore.",
    scanning: "Reading the dump to see which databases it holds…",
    madeBy: (origin: string) => `Made by ${origin}.`,
    severalInDump: "This dump holds several databases. Import",
    oneInDump: "Database in the dump",
    fromDumpLabel: "Database from the dump",
    sqlSize: (size: string) => `(${size} of SQL)`,
    skipsSystem: (list: string, n: number, server: string) =>
      `Zefaro skips ${list}: ${n > 1 ? "these are" : "this is"} ${server}'s own system ${n > 1 ? "databases" : "database"}, and the dump's copy comes from another server.`,
    onlySystem: "This dump holds only system databases, so there is nothing to import.",
    intoDatabase: "Into database",
    targetLabel: "Target database",
    alreadyExists: (name: string, size: string) =>
      `${name} already exists (${size}). Zefaro drops it and replaces it with the dump.`,
    replaceAndImport: "Replace and import",
    dropTitle: (name: string | undefined) => `Drop ${name}?`,
    dropDescription: (tables: number | undefined, size: string) =>
      `Zefaro deletes the database and its ${tables} tables (${size}). Export it first if you might need it. You can't undo this.`,
    dropDatabase: "Drop database",
  },
  id: {
    duration: {
      hm: (h: number, m: number) => `${h} j ${m} mnt`,
      ms: (m: number, s: string) => `${m} mnt ${s} dtk`,
      s: (s: number) => `${s} dtk`,
    },
    formats: {
      compressed: {
        title: "Terkompresi",
        text: "Biasanya 2 sampai 10 kali lebih kecil. Lebih lambat ditulis; Zefaro bisa langsung mengimpornya.",
      },
      plain: {
        title: "SQL biasa",
        text: "Paling cepat ditulis dan bisa dibuka di editor apa pun, tetapi filenya paling besar.",
      },
    },
    job: {
      export: {
        running: (db) => `Mengekspor ${db}`,
        done: (db) => `${db} sudah diekspor`,
        failed: (db) => `Ekspor ${db} gagal`,
        cancelled: (db) => `Ekspor ${db} dibatalkan`,
      } as JobTitles,
      import: {
        running: (db) => `Mengimpor ke ${db}`,
        done: (db) => `Impor ke ${db} selesai`,
        failed: (db) => `Impor ke ${db} gagal`,
        cancelled: (db) => `Impor ke ${db} dibatalkan`,
      } as JobTitles,
    },
    showInFolder: "Tampilkan di folder",
    dismiss: "Tutup",
    exportDone: (file: string, sql: string) => `File ${file} · ${sql} SQL`,
    importDone: (read: string) => `${read} dibaca`,
    progress: (done: string, total: string, exact: boolean) => `${done} dari ${exact ? "" : "sekitar "}${total}`,
    left: (d: string) => ` · sekitar ${d} lagi`,
    created: (name: string) => `${name} dibuat`,
    exportTitle: (name: string) => `Ekspor ${name}`,
    compressedSql: "SQL terkompresi",
    lowSpace: (free: string) => `Hanya tersisa ${free} di drive tersebut. Hasil ekspor mungkin tidak muat.`,
    importInto: (name: string) => `Impor ke ${name}`,
    importADatabase: "Impor database",
    sqlDump: "Dump SQL",
    dropped: (name: string) => `${name} dihapus`,
    title: "Database",
    description: (server: string, port: number) =>
      `${server} di 127.0.0.1:${port} · user root, tanpa password. Ekspor dan impor dump berapa pun ukurannya.`,
    servers: "Server database",
    importDump: "Impor dump…",
    newDatabase: "Database baru",
    notRunningTitle: (server: string) => `${server} tidak berjalan`,
    notRunningDescription: "Mulai server ini untuk melihat, mengekspor, dan mengimpor database Anda.",
    notInstalledDescription: (server: string) =>
      `Zefaro mengunduh ${server} saat pertama kali dimulai, lalu Anda bisa melihat, mengekspor, dan mengimpor database di sini.`,
    start: (server: string) => `Mulai ${server}`,
    emptyTitle: "Belum ada database",
    emptyDescription: "Buat satu, atau impor dump .sql atau .sql.gz.",
    colDatabase: "Database",
    colSize: "Ukuran",
    colTables: "Tabel",
    colActions: "Aksi",
    exporting: "Mengekspor",
    importing: "Mengimpor",
    export: "Ekspor",
    exportTip: (name: string) => `Simpan salinan ${name} ke file`,
    import: "Impor",
    importTip: (name: string) => `Ganti ${name} dengan file dump`,
    drop: (name: string) => `Hapus ${name}`,
    count: (n: number) => `${n} database`,
    freeOnDrive: (free: string) => `${free} tersisa di drive data`,
    newDescription: (pg: boolean) =>
      `Gunakan huruf, angka, _ dan -. Zefaro membuatnya dengan ${pg ? "UTF-8" : "utf8mb4"}.`,
    nameLabel: "Nama database",
    createDatabase: "Buat database",
    exportDialogBefore: "Ekspor ",
    exportSize: (size: string, tables: number) => `${size} dalam ${tables} tabel. `,
    exportEmpty: "Database ini kosong. ",
    exportIncludes: (server: string, pg: boolean) =>
      pg
        ? `Ekspor mencakup tabel, view, function, sequence, dan index, tanpa kepemilikan dan hak akses. ${server} tetap bisa dipakai selama ekspor berjalan.`
        : `Ekspor mencakup view, routine, trigger, dan event. ${server} tetap bisa dipakai selama ekspor berjalan.`,
    format: "Format",
    recommended: "Disarankan",
    chooseWhere: "Pilih lokasi simpan…",
    importFile: (file: string) => `Impor ${file}`,
    importAccepts: (pg: boolean) =>
      pg
        ? "Menerima SQL dari pg_dump (.sql atau .sql.gz) dan format custom pg_dump. Kepemilikan dan hak akses tidak ikut diimpor."
        : "Menerima dump .sql biasa atau terkompresi gzip dari Zefaro, mariadb-dump, mysqldump, atau phpMyAdmin.",
    customFormat: "Arsip pg_dump dalam format custom. Zefaro memuatnya dengan pg_restore.",
    scanning: "Membaca dump untuk melihat database apa saja di dalamnya…",
    madeBy: (origin: string) => `Dibuat oleh ${origin}.`,
    severalInDump: "Dump ini berisi beberapa database. Impor",
    oneInDump: "Database di dalam dump",
    fromDumpLabel: "Database dari dump",
    sqlSize: (size: string) => `(${size} SQL)`,
    skipsSystem: (list: string, _n: number, server: string) =>
      `Zefaro melewati ${list}: itu database sistem milik ${server} sendiri, dan salinan di dump ini berasal dari server lain.`,
    onlySystem: "Dump ini hanya berisi database sistem, jadi tidak ada yang bisa diimpor.",
    intoDatabase: "Ke database",
    targetLabel: "Database tujuan",
    alreadyExists: (name: string, size: string) =>
      `${name} sudah ada (${size}). Zefaro menghapusnya lalu menggantinya dengan isi dump.`,
    replaceAndImport: "Ganti dan impor",
    dropTitle: (name: string | undefined) => `Hapus ${name}?`,
    dropDescription: (tables: number | undefined, size: string) =>
      `Zefaro menghapus database ini beserta ${tables} tabelnya (${size}). Ekspor dulu jika Anda mungkin membutuhkannya. Tindakan ini tidak bisa dibatalkan.`,
    dropDatabase: "Hapus database",
  },
});
