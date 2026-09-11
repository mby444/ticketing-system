import { prisma } from "./lib/prisma";

async function main() {
  await prisma.user.create({
    data: {
      email: "user2@example.com",
      name: "user2",
      password: "password",
      tickets: {
        create: {
          subject: "Ticket 2",
          description: "Description 2",
          priority: "Low",
        },
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
