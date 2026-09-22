import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#0b1329",
      color: "#f8fafc",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "2rem",
      textAlign: "center"
    }}>
      <div style={{
        backgroundColor: "rgba(30, 41, 59, 0.7)",
        border: "1px solid rgba(148, 163, 184, 0.2)",
        borderRadius: "1rem",
        padding: "3rem 2rem",
        maxWidth: "480px",
        width: "100%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
      }}>
        <h1 style={{ fontSize: "5rem", margin: 0, fontWeight: 800, color: "#38bdf8" }}>404</h1>
        <h2 style={{ fontSize: "1.5rem", marginTop: "0.5rem", marginBottom: "1rem", color: "#e2e8f0" }}>
          Inspection Page Not Found
        </h2>
        <p style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "2rem", lineHeight: 1.5 }}>
          The requested resource or page does not exist or may have been relocated within the Inspectra Enforcement Portal.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            backgroundColor: "#0284c7",
            color: "#ffffff",
            fontWeight: 600,
            padding: "0.75rem 1.5rem",
            borderRadius: "0.5rem",
            textDecoration: "none",
            transition: "background-color 0.2s"
          }}
        >
          Return to Portal Dashboard
        </Link>
      </div>
    </div>
  );
}
