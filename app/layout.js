import './globals.css'

export const metadata = {
  title: 'The Bagel Bowl 🥯',
  description: "Cream Cheese Championship — don't embarrass your cheese.",
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
