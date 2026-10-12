export const BRAND_NAME = "Luma";

export function Brand() {
  return (
    <div className="brand-mark">
      <span className="brand-orbit" />
      <span>{BRAND_NAME}</span>
    </div>
  );
}
