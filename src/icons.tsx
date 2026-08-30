const PATHS: Record<string, string> = {
  home: "M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9",
  wallet: "M3 10h18",
  swap: "M4 7h13l-3-3M20 17H7l3 3",
  trend: "M3 17 9 11l4 4 8-8M15 7h6v6",
  pie: "M12 3v9l7.5 4.3M20.9 13.5A9 9 0 1 1 12 3",
  flag: "M6 21V4M6 4h12l-3 4 3 4H6",
  repeat: "M17 2 21 6l-4 4M3 12V9a3 3 0 0 1 3-3h15M7 22 3 18l4-4M21 12v3a3 3 0 0 1-3 3H3",
  barchart: "M4 20V10M12 20V4M20 20v-7",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.6 9.4a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1 .9-1 1.7v.2M12 16.8v.2",
};

export function NavIcon({ name }: { name: string }) {
  if (name === "wallet") {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
