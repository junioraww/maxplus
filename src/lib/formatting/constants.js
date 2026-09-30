export const STYLE_KEYS = {
  BOLD: "bold",
  ITALIC: "italic",
  UNDERLINE: "underline",
  STRIKE: "strike",
  CODE: "code",
  QUOTE: "quote",
  HEADING: "heading",
  LINK: "link",
  MENTION: "mention",
  ANIMOJI: "animoji",
};

export const STYLE_TO_SERVER_NAME = {
  [STYLE_KEYS.BOLD]: "STRONG",
  [STYLE_KEYS.ITALIC]: "EMPHASIZED",
  [STYLE_KEYS.UNDERLINE]: "UNDERLINE",
  [STYLE_KEYS.STRIKE]: "STRIKETHROUGH",
  [STYLE_KEYS.CODE]: "MONOSPACED",
  [STYLE_KEYS.QUOTE]: "QUOTE",
  [STYLE_KEYS.HEADING]: "HEADING",
  [STYLE_KEYS.LINK]: "LINK",
  [STYLE_KEYS.MENTION]: "USER_MENTION",
  [STYLE_KEYS.ANIMOJI]: "ANIMOJI",
};

export const SERVER_NAME_TO_STYLE = Object.entries(STYLE_TO_SERVER_NAME).reduce(
  (acc, [styleKey, wireName]) => {
    acc[wireName] = styleKey;
    return acc;
  },
  {}
);

export const COMPOSER_STYLES = [
  STYLE_KEYS.BOLD,
  STYLE_KEYS.ITALIC,
  STYLE_KEYS.UNDERLINE,
  STYLE_KEYS.STRIKE,
  STYLE_KEYS.CODE,
  STYLE_KEYS.QUOTE,
];
