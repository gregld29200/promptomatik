// The illustration the teacher adds to the worksheet in the Documents
// tutorial: a fruit and vegetable stall at the market, with no one in it.
// Drawn here, so it belongs to no one.
export const STALL_SIZE = { width: 1200, height: 570 };

const crate = (x: number, y: number, w: number, fill: string, dots: string) => {
  const fruit = Array.from({ length: Math.floor(w / 34) }, (_, i) => {
    const cx = x + 22 + i * 34;
    return `<circle cx="${cx}" cy="${y + 6}" r="17" fill="${fill}"/><circle cx="${cx + 6}" cy="${y}" r="4" fill="${dots}" opacity="0.6"/>`;
  }).join("");
  return `${fruit}<rect x="${x}" y="${y + 10}" width="${w}" height="56" rx="3" fill="#c99a5b"/>
    <rect x="${x}" y="${y + 28}" width="${w}" height="6" fill="#b9874e"/><rect x="${x}" y="${y + 46}" width="${w}" height="6" fill="#b9874e"/>`;
};

export const STALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="570" viewBox="0 0 1200 570">
  <rect width="1200" height="570" fill="#f4efe6"/>
  <circle cx="980" cy="120" r="170" fill="#e2ebe6"/>
  <rect x="0" y="500" width="1200" height="70" fill="#e7dcc9"/>

  <g>
    <rect x="150" y="70" width="12" height="430" fill="#132038"/>
    <rect x="1038" y="70" width="12" height="430" fill="#132038"/>
    <path d="M110 70 H1090 L1060 150 H140 Z" fill="#355343"/>
    ${Array.from({ length: 7 }, (_, i) => `<path d="M${140 + i * 131} 150 h131 l-65.5 38 Z" fill="${i % 2 ? "#355343" : "#f4efe6"}"/>`).join("")}
    <rect x="110" y="60" width="980" height="14" fill="#2a4535"/>
  </g>

  <rect x="190" y="420" width="820" height="80" fill="#b9874e"/>
  <rect x="180" y="404" width="840" height="20" rx="3" fill="#a8743f"/>

  ${crate(205, 330, 240, "#bf4e36", "#f4efe6")}
  ${crate(475, 330, 240, "#dfc052", "#f4efe6")}
  ${crate(745, 330, 240, "#7fa99b", "#f4efe6")}
  ${crate(330, 250, 220, "#c0392b", "#2a4535")}
  ${crate(620, 250, 220, "#e08a3c", "#f4efe6")}

  <g transform="rotate(-6 600 230)">
    <rect x="530" y="200" width="140" height="60" rx="4" fill="#fffaf0" stroke="#132038" stroke-width="3"/>
    <text x="600" y="240" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="30" fill="#132038">2 € / kg</text>
  </g>

  <g>
    <path d="M90 500 l20 -110 h110 l20 110 Z" fill="#c99a5b"/>
    <path d="M100 410 q65 -70 130 0" fill="none" stroke="#a8743f" stroke-width="10"/>
    <circle cx="140" cy="405" r="18" fill="#bf4e36"/><circle cx="175" cy="398" r="18" fill="#dfc052"/><circle cx="205" cy="408" r="16" fill="#7fa99b"/>
  </g>
</svg>`;
