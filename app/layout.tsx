import type { Metadata } from 'next';
import { Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google';
import './globals.css';

const sans = Noto_Sans_SC({ variable: '--font-sans', subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const serif = Noto_Serif_SC({ variable: '--font-serif', subsets: ['latin'], weight: ['600', '700', '900'] });
const siteUrl = new URL('https://chuhe-wangyu-endgame.lrk-wer.chatgpt.site');
const title = '楚河·王域｜象棋 VS 国际象棋残局实验室';
const description = '在 9×10 混合棋盘上破解只有一到两步生路的跨棋种残局。';
const socialImage = new URL('/og.png', siteUrl).toString();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  alternates: { canonical: siteUrl },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: '楚河·王域',
    locale: 'zh_CN',
    type: 'website',
    images: [{ url: socialImage, width: 1200, height: 630, alt: '楚河·王域混合残局棋盘' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: [socialImage] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${sans.variable} ${serif.variable}`}>{children}</body></html>;
}
