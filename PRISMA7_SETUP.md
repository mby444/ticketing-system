# PostgreSQL (/docs/v7/prisma-orm/add-to-existing-project/postgresql)

> For the complete Prisma documentation index, see [llms.txt](https://www.prisma.io/docs/llms.txt). A markdown version of any docs page is available by appending `.md` to its URL.

Add Prisma ORM to an existing TypeScript project with PostgreSQL and learn database introspection, baselining, and querying

Location: v7 > Prisma ORM > Add to Existing Project > PostgreSQL

[PostgreSQL](https://www.postgresql.org/) is a widely used open-source relational database. In this guide, you will learn how to add Prisma ORM to an existing TypeScript project, connect it to PostgreSQL, introspect your existing database schema, and start querying with type-safe Prisma Client.

## Prerequisites [#prerequisites]

## 1. Set up Prisma ORM [#1-set-up-prisma-orm]

Navigate to your existing project directory and install the required dependencies:

#### bun

```bash
bun add prisma@7.10.0 @types/node @types/pg --dev
bun add @prisma/client@7.10.0 @prisma/adapter-pg pg dotenv
```

#### pnpm

```bash
pnpm add prisma@7.10.0 @types/node @types/pg --save-dev
pnpm add @prisma/client@7.10.0 @prisma/adapter-pg pg dotenv
```

#### yarn

```bash
yarn add prisma@7.10.0 @types/node @types/pg --dev
yarn add @prisma/client@7.10.0 @prisma/adapter-pg pg dotenv
```

#### npm

```bash
npm install prisma@7.10.0 @types/node @types/pg --save-dev
npm install @prisma/client@7.10.0 @prisma/adapter-pg pg dotenv
```

Here's what each package does:

- **`prisma`** - The Prisma CLI for running commands like `prisma init`, `prisma db pull`, and `prisma generate`
- **`@prisma/client`** - The Prisma Client library for querying your database
- **`@prisma/adapter-pg`** - The [`node-postgres` driver adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql#using-driver-adapters) that connects Prisma Client to your database
- **`pg`** - The node-postgres database driver
- **`@types/pg`** - TypeScript type definitions for node-postgres
- **`dotenv`** - Loads environment variables from your `.env` file

## 2. Initialize Prisma ORM [#2-initialize-prisma-orm]

Set up your Prisma ORM project by creating your [Prisma Schema](https://www.prisma.io/docs/orm/v7/prisma-schema/overview) file with the following command:

#### bun

```bash
bunx --bun prisma init --datasource-provider postgresql --output ../generated/prisma
```

#### pnpm

```bash
pnpm dlx prisma init --datasource-provider postgresql --output ../generated/prisma
```

#### yarn

```bash
yarn dlx prisma init --datasource-provider postgresql --output ../generated/prisma
```

#### npm

```bash
npx prisma init --datasource-provider postgresql --output ../generated/prisma
```

This command does a few things:

- Creates a `prisma/` directory with a `schema.prisma` file containing your database connection configuration
- Creates a `.env` file in the root directory for environment variables
- Creates a `prisma.config.ts` file for Prisma configuration

The generated `prisma.config.ts` file looks like this:

```typescript title="prisma.config.ts"
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

The generated schema uses [the ESM-first `prisma-client` generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators#prisma-client) with a custom output path:

```prisma title="prisma/schema.prisma"
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

## 3. Connect your database [#3-connect-your-database]

Update the `.env` file with your PostgreSQL connection URL:

```text title=".env"
DATABASE_URL="postgresql://user:password@localhost:5432/mydb?schema=public"
```

The [format of the connection URL](https://www.prisma.io/docs/orm/v7/reference/connection-urls) for PostgreSQL looks as follows:

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=SCHEMA
```

## 4. Introspect your database [#4-introspect-your-database]

Run the following command to introspect your existing database:

#### bun

```bash
bunx prisma db pull
```

#### pnpm

```bash
pnpm dlx prisma db pull
```

#### yarn

```bash
yarn dlx prisma db pull
```

#### npm

```bash
npx prisma db pull
```

This command reads the `DATABASE_URL` environment variable, connects to your database, and introspects the database schema. It then translates the database schema from SQL into a data model in your Prisma schema.

![Introspect your database with Prisma ORM](https://www.prisma.io/img/getting-started/prisma-db-pull-generate-schema.png)

After introspection, your Prisma schema will contain models that represent your existing database tables.

## 5. Baseline your database [#5-baseline-your-database]

To use Prisma Migrate with your existing database, you need to [baseline your database](https://www.prisma.io/docs/orm/v7/prisma-migrate/getting-started).

First, create a `migrations` directory:

```bash
mkdir -p prisma/migrations/0_init
```

Next, generate the migration file with `prisma migrate diff`:

#### bun

```bash
bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
```

#### pnpm

```bash
pnpm dlx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
```

#### yarn

```bash
yarn dlx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
```

#### npm

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
```

Review the generated migration file to ensure it matches your database schema.

Then, mark the migration as applied:

#### bun

```bash
bunx prisma migrate resolve --applied 0_init
```

#### pnpm

```bash
pnpm dlx prisma migrate resolve --applied 0_init
```

#### yarn

```bash
yarn dlx prisma migrate resolve --applied 0_init
```

#### npm

```bash
npx prisma migrate resolve --applied 0_init
```

You now have a baseline for your current database schema.

## 6. Generate Prisma ORM types [#6-generate-prisma-orm-types]

Generate Prisma Client based on your introspected schema:

#### bun

```bash
bunx prisma generate
```

#### pnpm

```bash
pnpm dlx prisma generate
```

#### yarn

```bash
yarn dlx prisma generate
```

#### npm

```bash
npx prisma generate
```

This creates a type-safe Prisma Client tailored to your database schema in the `generated/prisma` directory.

## 7. Instantiate Prisma Client [#7-instantiate-prisma-client]

Create a utility file to instantiate Prisma Client. You need to pass an instance of the Prisma ORM driver adapter adapter to the `PrismaClient` constructor:

```typescript title="lib/prisma.ts"
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };
```

## 8. Query your database [#8-query-your-database]

Now you can use Prisma Client to query your database. Create a `script.ts` file:

```typescript title="script.ts"
import { prisma } from "./lib/prisma";

async function main() {
  // Example: Fetch all records from a table
  // Replace 'user' with your actual model name
  const allUsers = await prisma.user.findMany();
  console.log("All users:", JSON.stringify(allUsers, null, 2));
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
```

Run the script:

#### bun

```bash
bunx tsx script.ts
```

#### pnpm

```bash
pnpm dlx tsx script.ts
```

#### yarn

```bash
yarn dlx tsx script.ts
```

#### npm

```bash
npx tsx script.ts
```

## 9. Evolve your schema [#9-evolve-your-schema]

To make changes to your database schema:

### 9.1. Update your Prisma schema file [#91-update-your-prisma-schema-file]

Update your Prisma schema file to reflect the changes you want to make to your database schema. For example, add a new model:

```prisma title="prisma/schema.prisma"
model Post { // [!code ++]
  id        Int      @id @default(autoincrement()) // [!code ++]
  title     String // [!code ++]
  content   String? // [!code ++]
  published Boolean  @default(false) // [!code ++]
  authorId  Int // [!code ++]
  author    User     @relation(fields: [authorId], references: [id]) // [!code ++]
} // [!code ++]

model User { // [!code ++]
  id    Int    @id @default(autoincrement()) // [!code ++]
  email String @unique // [!code ++]
  name  String? // [!code ++]
  posts Post[] // [!code ++]
} // [!code ++]
```

### 9.2. Create and apply a migration: [#92-create-and-apply-a-migration]

#### bun

```bash
bunx prisma migrate dev --name your_migration_name
```

#### pnpm

```bash
pnpm dlx prisma migrate dev --name your_migration_name
```

#### yarn

```bash
yarn dlx prisma migrate dev --name your_migration_name
```

#### npm

```bash
npx prisma migrate dev --name your_migration_name
```

This command will:

- Create a new SQL migration file
- Apply the migration to your database
- Regenerate Prisma Client

## 10. Explore your data with Prisma Studio [#10-explore-your-data-with-prisma-studio]

```shell
npx prisma studio
```

## Next steps [#next-steps]

Prisma ORM is set up. These are the pages you are most likely to need next:

- **Learn more about Prisma Client**: Explore the [Prisma Client API](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction) for advanced querying, filtering, and relations
- **Database migrations**: Learn about [Prisma Migrate](https://www.prisma.io/docs/orm/v7/prisma-migrate) for evolving your database schema
- **Performance optimization**: Discover [query optimization techniques](https://www.prisma.io/docs/orm/v7/prisma-client/queries/advanced/query-optimization-performance)
- **Build a full application**: Check out our [framework guides](https://www.prisma.io/docs/guides/v7) to integrate Prisma ORM with Next.js, Express, and more
- **Join the community**: Connect with other developers on [Discord](https://pris.ly/discord)

## More info [#more-info]

- [PostgreSQL database connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)
- [Prisma Config reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
- [Database introspection](https://www.prisma.io/docs/orm/v7/prisma-schema/introspection)
- [Prisma Migrate](https://www.prisma.io/docs/orm/v7/prisma-migrate)

## Related pages

- [`CockroachDB`](https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/cockroachdb): Add Prisma ORM to an existing TypeScript project with CockroachDB and learn database introspection, baselining, and querying
- [`MongoDB`](https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/mongodb): Add Prisma ORM to an existing TypeScript project with MongoDB and learn database introspection and querying
- [`MySQL`](https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/mysql): Add Prisma ORM to an existing TypeScript project with MySQL and learn database introspection, baselining, and querying
- [`PlanetScale`](https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/planetscale): Add Prisma ORM to an existing TypeScript project with PlanetScale and learn database introspection and querying
- [`Prisma Postgres`](https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/prisma-postgres): Add Prisma ORM to an existing TypeScript project with Prisma Postgres and learn database introspection, baselining, and querying
