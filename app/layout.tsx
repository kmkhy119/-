import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: '勤務表作成',
  description: '勤務表作成ツール',
  icons: {
    apple: '/icon.png',
    icon: '/icon.png',
  },
  manifest: '/manifest.json',
};

export const viewport = {
  width: 1200,
  userScalable: true,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable}`}>
      <body className="font-sans antialiased bg-slate-50 text-slate-900" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
