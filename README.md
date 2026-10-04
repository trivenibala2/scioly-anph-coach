# Pulse Notes

A no-login Science Olympiad Anatomy & Physiology coach. Students add a text-based PDF, review the extracted page text, and generate a short lesson with source page citations. PDF extraction happens in the browser; only extracted text is sent to Gemini. Lessons and uploads are not saved.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and add a Gemini API key as `GEMINI_API_KEY`.
3. Start the app with `npm run dev` and open [http://localhost:3000](http://localhost:3000).

The Gemini key must stay in the server environment. Do not expose it as a `NEXT_PUBLIC_` variable. Scanned/image-only PDFs are not supported because OCR is not included.

## Scripts

- `npm run dev` starts the development server.
- `npm run lint` runs ESLint.
- `npm run build` creates a production build.

## Data handling

There is no account system or database. The PDF is parsed on the student’s device and is not uploaded. Extracted page text is sent to the Gemini API only when the student selects **Generate lesson**; the generated lesson remains in the current browser session.
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
