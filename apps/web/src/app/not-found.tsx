// Fallback for paths outside any locale (the proxy normally adds one).
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', textAlign: 'center' }}>
        <h1>404</h1>
        {/* No locale is known here, so the page speaks every language Raadiso has. */}
        <p lang="nb">Fant ikke siden.</p>
        <p lang="en">Page not found.</p>
        <p lang="so">Boggan lama helin.</p>
        <p>
          <a href="/">Raadiso</a>
        </p>
      </body>
    </html>
  );
}
