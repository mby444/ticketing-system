import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const subjects = [
  "Kendala koneksi database",
  "Error saat upload file lampiran",
  "Permintaan reset kata sandi",
  "Integrasi payment gateway gagal",
  "Fitur ekspor CSV tidak merespons",
  "Bug pada tampilan mobile menu",
  "Aplikasi lambat saat memuat dashboard",
  "Email notifikasi tidak terkirim",
  "Permintaan akses modul laporan",
  "Masalah sinkronisasi waktu UTC",
];

const descriptions = [
  "Terjadi kendala konsisten saat pengguna melakukan aksi ini di lingkungan produksi.",
  "Sistem menampilkan respon error 500 saat tombol diklik.",
  "Pengguna melaporkan pesan kesalahan yang tidak intuitif saat pengisian formulir.",
  "Sering mengalami timeout ketika memproses permintaan beban tinggi.",
  "Dibutuhkan investigasi lebih lanjut mengenai akar masalah kendala ini.",
];

const priorities = ["Low", "Medium", "High", "Critical"];
const statuses = ["Open", "In Progress", "Resolved", "Closed"];

// Fungsi helper untuk mengambil elemen acak dari array
const getRandomItem = <T>(array: T[]): T =>
  array[Math.floor(Math.random() * array.length)];

// Fungsi helper untuk generate angka acak
const getRandomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  console.log("Memulai proses pembersihan database...");
  await prisma.ticket.deleteMany();
  await prisma.user.deleteMany();

  console.log("Menyiapkan hash password...");
  const hashedPassword = await bcrypt.hash("password123", 10);

  console.log("Memulai seeding 20 user beserta tiket...");

  // Generate 20 User secara paralel
  const userPromises = Array.from({ length: 20 }).map((_, index) => {
    const userNumber = index + 1;
    const ticketCount = getRandomInt(1, 4); // Setiap user mendapat 1 - 4 tiket

    // Generate array data tiket untuk nested create
    const ticketsData = Array.from({ length: ticketCount }).map(() => ({
      subject: getRandomItem(subjects),
      description: getRandomItem(descriptions),
      priority: getRandomItem(priorities),
      status: getRandomItem(statuses),
    }));

    return prisma.user.create({
      data: {
        email: `user${userNumber}@example.com`,
        name: `User Ke-${userNumber}`,
        password: hashedPassword,
        tickets: {
          create: ticketsData,
        },
      },
    });
  });

  await Promise.all(userPromises);

  const totalUsers = await prisma.user.count();
  const totalTickets = await prisma.ticket.count();

  console.log(`\nSeeding selesai!`);
  console.log(`- Total User dibuat   : ${totalUsers}`);
  console.log(`- Total Tiket dibuat  : ${totalTickets}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Error saat seeding:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
