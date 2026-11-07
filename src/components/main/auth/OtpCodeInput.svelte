<script>
  import { createEventDispatcher, onMount } from "svelte";

  export let length = 6;
  export let value = "";
  export let disabled = false;
  export let autofocus = true;

  const dispatch = createEventDispatcher();

  let inputElements = [];
  let digits = Array(length).fill("");
  let focusedIndex = 0;

  $: {
    const clean = (value || "").replace(/\D/g, "").slice(0, length);
    digits = Array(length)
      .fill("")
      .map((_, i) => clean[i] || "");
  }

  onMount(() => {
    if (autofocus && inputElements[0]) {
      inputElements[0].focus();
    }
  });

  function focusIndex(index) {
    if (index >= 0 && index < length && inputElements[index]) {
      inputElements[index].focus();
    }
  }

  function handleInput(e, index) {
    const val = e.target.value.replace(/\D/g, "");
    if (!val) {
      digits[index] = "";
      updateValue();
      return;
    }

    if (val.length === 1) {
      digits[index] = val;
      updateValue();
      if (index < length - 1) {
        focusIndex(index + 1);
      }
    } else {
      handlePastedString(val, index);
    }
  }

  function handleKeyDown(e, index) {
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        digits[index - 1] = "";
        updateValue();
        focusIndex(index - 1);
        e.preventDefault();
      } else {
        digits[index] = "";
        updateValue();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      focusIndex(index - 1);
      e.preventDefault();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      focusIndex(index + 1);
      e.preventDefault();
    }
  }

  function handlePaste(e, index) {
    e.preventDefault();
    const pasted = e.clipboardData?.getData("text") || "";
    handlePastedString(pasted, index);
  }

  function handlePastedString(str, startIndex = 0) {
    const chars = str.replace(/\D/g, "").split("");
    if (!chars.length) return;

    let targetIdx = startIndex;
    for (let i = 0; i < chars.length && targetIdx < length; i++) {
      digits[targetIdx] = chars[i];
      targetIdx++;
    }
    updateValue();
    focusIndex(Math.min(targetIdx, length - 1));
  }

  function updateValue() {
    const code = digits.join("");
    value = code;
    dispatch("input", code);
    if (code.length === length) {
      dispatch("complete", code);
    }
  }
</script>

<div class="otp-container">
  {#each digits as digit, i}
    <div
      class="otp-cell"
      class:focused={focusedIndex === i && !disabled}
      class:filled={Boolean(digit)}
      on:click={() => focusIndex(i)}
    >
      <input
        bind:this={inputElements[i]}
        type="text"
        inputmode="numeric"
        maxlength="1"
        pattern="[0-9]*"
        autocomplete="one-time-code"
        value={digit}
        {disabled}
        on:input={(e) => handleInput(e, i)}
        on:keydown={(e) => handleKeyDown(e, i)}
        on:paste={(e) => handlePaste(e, i)}
        on:focus={() => (focusedIndex = i)}
        on:blur={() => {
          if (focusedIndex === i) focusedIndex = -1;
        }}
      />
      {#if !digit && focusedIndex === i && !disabled}
        <span class="blinking-cursor"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .otp-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 24px 0;
  }

  .otp-cell {
    position: relative;
    width: 48px;
    height: 58px;
    border-radius: 14px;
    background: var(--auth-input-bg, #eff0f4);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .otp-cell.focused {
    background: var(--auth-input-bg, #eff0f4);
    box-shadow: 0 0 0 1.5px rgba(0, 122, 255, 0.4);
  }

  .otp-cell input {
    width: 100%;
    height: 100%;
    text-align: center;
    font-size: 24px;
    font-weight: 700;
    color: var(--auth-text, #000000);
    background: transparent;
    border: none;
    outline: none;
    caret-color: transparent;
    padding: 0;
    font-family: inherit;
    -webkit-user-select: text;
    user-select: text;
  }

  .blinking-cursor {
    position: absolute;
    width: 2px;
    height: 24px;
    background-color: #007aff;
    border-radius: 1px;
    pointer-events: none;
    animation: cursor-blink 1.05s infinite;
  }

  @keyframes cursor-blink {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  @media (max-width: 360px) {
    .otp-container {
      gap: 6px;
    }
    .otp-cell {
      width: 42px;
      height: 52px;
      border-radius: 12px;
    }
    .otp-cell input {
      font-size: 20px;
    }
  }
</style>
