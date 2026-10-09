export const TEXT_REVEAL_EYEBROWS = '.text-style-eyebrow,.eyebrow,[data-el="eyebrow"]';
export const TEXT_REVEAL_SELECTOR =
  'h1,h2,h3,h4,h5,h6,p,' +
  TEXT_REVEAL_EYEBROWS +
  ',.w-richtext li,.w-richtext blockquote,.rich-text li,.rich-text blockquote,' +
  '[data-text-reveal="heading"],[data-text-reveal="paragraph"],' +
  '[data-text-reveal="eyebrow"],[data-text-reveal="menu"],[data-text-reveal="chars"]';

const HEADING = {
  type: 'chars',
  duration: 1.5,
  stagger: 0.025,
  delay: 0,
  ease: 'power3.out',
  from: 'start',
  blur: 22,
  rotation: 12,
  rotationX: -21,
  y: 100,
  x: 0,
  opacity: 0,
  scale: 0.95,
  transformOrigin: '50% 100%',
  transformPerspective: 800,
} as const;
const PARAGRAPH = {
  ...HEADING,
  type: 'lines',
  stagger: 0.1,
  blur: 0,
  rotation: 0,
  rotationX: 0,
  y: 30,
  scale: 1,
  transformOrigin: '0% 100%',
} as const;

export const TEXT_REVEAL_PRESETS = {
  heading: HEADING,
  paragraph: PARAGRAPH,
  eyebrow: PARAGRAPH,
  menu: {
    ...HEADING,
    type: 'words',
    duration: 0.55,
    blur: 8,
    rotation: 3,
    rotationX: 0,
    y: 28,
    scale: 1,
    transformPerspective: 0,
  },
} as const;
