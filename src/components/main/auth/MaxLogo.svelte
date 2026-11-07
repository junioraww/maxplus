<script>
  export let size = 34;
</script>

<div class="logo-wrapper">
  <svg
    class="logo-icon"
    width={size}
    height={size}
    viewBox="0 0 128 128"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="128" height="128" rx="40" fill="white" />
    <rect width="128" height="128" rx="40" fill="url(#maxplus_p0)" />
    <rect width="128" height="128" rx="40" fill="url(#maxplus_p1)" />
    <rect width="128" height="128" rx="40" fill="url(#maxplus_p2)" />
    <circle cx="63.5" cy="64.5" r="34" stroke="white" stroke-width="21" />
    <path
      d="M21.0012 65C21.0012 65 20.8224 54.4705 24.9076 43.596C28.9929 32.7214 28.1048 22.8824 30.2362 20.811C32.3676 18.7395 42.9198 20.7797 48 25.2988L21.0012 65Z"
      fill="white"
      stroke="white"
    />
    <path
      d="M105.999 66C105.999 66 106.171 55.2365 102.237 44.1203C98.3032 33.0041 99.1584 22.9465 97.1059 20.829C95.0534 18.7115 84.8921 20.797 80 25.4166L105.999 66Z"
      fill="white"
      stroke="white"
    />
    <defs>
      <radialGradient
        id="maxplus_p0"
        cx="0"
        cy="0"
        r="1"
        gradientUnits="userSpaceOnUse"
        gradientTransform="translate(114.56 60.48) rotate(160.276) scale(490.201)"
      >
        <stop stop-color="#9900FF" />
        <stop offset="1" stop-color="#8C07E5" stop-opacity="0" />
      </radialGradient>
      <radialGradient
        id="maxplus_p1"
        cx="0"
        cy="0"
        r="1"
        gradientUnits="userSpaceOnUse"
        gradientTransform="translate(32.32 38.08) rotate(70.592) scale(95.3374)"
      >
        <stop offset="0.0129732" stop-color="#0048FF" />
        <stop offset="1" stop-color="#003CFF" stop-opacity="0" />
      </radialGradient>
      <radialGradient
        id="maxplus_p2"
        cx="0"
        cy="0"
        r="1"
        gradientUnits="userSpaceOnUse"
        gradientTransform="translate(15.36 126.4) rotate(17.5965) scale(103.734)"
      >
        <stop stop-color="#00D0FF" />
        <stop offset="1" stop-color="#00D0FF" stop-opacity="0" />
      </radialGradient>
    </defs>
  </svg>
  <span class="logo-text">MAX+</span>
</div>

<style>
  .logo-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    user-select: none;
  }

  .logo-icon {
    display: block;
    flex-shrink: 0;
    border-radius: 10px;
  }

  .logo-text {
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.4px;
    color: var(--auth-text, #000000);
  }

  :global(.dark-theme) .logo-text,
  :global([data-theme="dark"]) .logo-text {
    color: #ffffff;
  }
</style>
