export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="-12 -12 24 24" width={size} height={size} aria-hidden="true">
      <circle r="10.5" fill="none" stroke="rgb(238 232 220)" strokeOpacity=".7" strokeWidth="1.2" />
      <circle r="6.2" fill="none" stroke="rgb(184 137 46)" strokeWidth="1.2" />
      <path d="M0-10.5V-6.2" stroke="rgb(184 137 46)" strokeWidth="1.6" />
    </svg>
  );
}
