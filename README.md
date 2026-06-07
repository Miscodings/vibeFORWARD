This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Run the app (frontend + backend)

This repo is a two-process app: a Next.js frontend (this directory) and a
FastAPI backend (`underwire/`). To start **both** with one command, see
[`RUN.md`](./RUN.md). Quick start:

```bash
docker compose up --build      # recommended (containers ship Node 20)
# or, locally:
./scripts/dev-all.ps1          # Windows / PowerShell
./scripts/dev-all.sh           # macOS / Linux / Git-Bash
```

Frontend: http://localhost:3000 · Backend docs: http://localhost:8000/docs

> Note: the local frontend needs **Node >= 20.9** (Next 16 requirement). On
> Node 18 use the Docker path. See [`RUN.md`](./RUN.md) for details.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
