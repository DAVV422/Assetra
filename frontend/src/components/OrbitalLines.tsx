export function OrbitalLines() {
  return (
    <svg className="orbital-lines" viewBox="0 0 1200 330" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: 29 }, (_, index) => (
        <path
          key={index}
          d="M-40 92 C130 210 245 18 430 105 S720 210 865 72 S1080 190 1240 76"
          transform={`translate(0 ${index * 5.2})`}
        />
      ))}
    </svg>
  );
}
