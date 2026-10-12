export const BRAND_NAME = "Rewiter";
export const BRAND_NAME_KO = "리위터";

/**
 * 로고: "readwithhighlighter" 중 r·e·w·i·t·e·r 에만 형광펜을 칠해 "rewiter(리위터)"로 읽힌다.
 * 하이라이트만 읽어도 핵심이 보인다는 서비스 정체성을 이름에 담았다.
 */
const PARTS: [string, boolean][] = [
  ["re", true], ["ad", false], ["wit", true], ["hhighlight", false], ["er", true],
];

export function Brand() {
  return (
    <div className="brand-mark" aria-label={`${BRAND_NAME} ${BRAND_NAME_KO}`} title={`${BRAND_NAME} · ${BRAND_NAME_KO}`}>
      <span className="brand-word" aria-hidden>
        {PARTS.map(([text, marked], i) => (marked ? <mark key={i}>{text}</mark> : <span key={i}>{text}</span>))}
      </span>
    </div>
  );
}
