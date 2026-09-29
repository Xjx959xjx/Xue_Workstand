type AppIconArtworkProps = { size: number };

export function AppIconArtwork({ size }: AppIconArtworkProps) {
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#142c29" }}>
      <svg width={size * .7} height={size * .7} viewBox="0 0 64 64" fill="none" stroke="#d1edb4" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        <path d="m13 25 19-10 19 10-19 10z" />
        <path d="m13 34 19 10 19-10M13 43l19 10 19-10" />
      </svg>
    </div>
  );
}
