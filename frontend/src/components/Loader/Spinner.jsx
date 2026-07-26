export function Spinner({ size = 24 }) {
  return (
    <span
      className="inline-block rounded-full border-2 border-white/20 border-t-primary animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

export default Spinner;