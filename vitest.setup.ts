// Runs before every test file, before any module is imported.
//
// 1. dotenv is loaded explicitly. lib/prisma.ts does its own
//    `import "dotenv/config"`, but that chain disappears as soon as a test
//    mocks @/lib/prisma — leaving EMAIL_FROM / APP_URL undefined and making
//    lib/email.ts throw "EMAIL_FROM is not set".
import "dotenv/config";

// 2. Safety rail. lib/prisma.ts builds a pg.Pool at module scope and would
//    otherwise connect to the live Neon database the moment an unmocked query
//    runs. dotenv never overrides an existing value, so this wins: any test
//    that forgets to mock @/lib/prisma now fails instantly against a dead
//    local socket instead of quietly reading or writing real data.
process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/none";
