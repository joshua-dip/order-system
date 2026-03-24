This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

### 배포 환경에서 Claude(AI)가 동작하지 않을 때

1. **API 키**: 로컬의 `.env.local`은 Git/배포에 올라가지 않습니다. Vercel이면 **Project → Settings → Environment Variables**에 `ANTHROPIC_API_KEY`를 넣고 재배포하세요. Preview 배포에서도 쓰려면 **Preview** 환경에도 같은 키를 추가하세요.
2. **타임아웃**: Vercel **Hobby(무료)** 플랜은 서버리스 함수가 약 **10초** 안에 끝나야 해서, Claude 초안·풀기처럼 긴 호출은 중간에 끊길 수 있습니다. **Pro** 등으로 올리거나, 해당 작업은 `npm run dev` 로컬에서 하세요.
3. Claude 관련 API 라우트에는 `maxDuration`(최대 120초)을 넣어 두었습니다. 플랜 상한을 넘으면 여전히 잘립니다.
