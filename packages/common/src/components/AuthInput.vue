<script setup lang="ts">
// A plain, native text input for the sign-in and registration forms.
//
// These forms don't use the Material text field (TextInput) on purpose: its
// real <input> sits inside a shadow DOM, and a browser's autofill or password
// manager (Firefox's in particular) can fill it without the component
// noticing, which left filled-in fields flagged as "required". A native input
// in the page itself is what those tools are built for.
//
// Give it a `name`: forms read their values from the <form> when submitted
// (see readFormValues in lib/account.ts), so a value never depends on an
// input event having fired.
defineProps<{
    label: string;
    name: string;
    type?: string;
    autocomplete?: string;
    // Show the field as missing.
    error?: boolean;
    errorText?: string;
}>();
const model = defineModel<string>({ default: '' });
</script>

<template>
    <label class="auth-input" :class="{ 'auth-input--error': error }">
        <span class="auth-input-label">{{ label }}</span>
        <!-- Enter submits the form. (The forms' buttons are Material ones,
             which browsers don't count as the default submit button.) -->
        <input
            v-model="model"
            class="auth-input-field"
            :type="type ?? 'text'"
            :name="name"
            :autocomplete="autocomplete"
            :aria-invalid="error || undefined"
            @keydown.enter.prevent="($event.target as HTMLInputElement).form?.requestSubmit()"
        />
        <span v-if="error" class="auth-input-error">{{ errorText ?? 'This field is required' }}</span>
    </label>
</template>

<style scoped>
.auth-input {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    min-width: min(280px, 100%);
    text-align: left;
}

.auth-input-label {
    font-size: 0.85rem;
    opacity: 0.8;
}

.auth-input-field {
    width: 100%;
    padding: 14px 12px;
    box-sizing: border-box;
    border: 1px solid var(--md-sys-color-outline, #888);
    border-radius: 4px;
    background: transparent;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 1rem;
    /* Lets the browser pick readable autofill colors in either theme. */
    color-scheme: light dark;
}

.auth-input-field:focus {
    outline: 2px solid var(--md-sys-color-primary, #ac6003);
    outline-offset: -1px;
    border-color: transparent;
}

.auth-input--error .auth-input-field {
    border-color: #c0392b;
}

.auth-input--error .auth-input-label,
.auth-input-error {
    color: #c0392b;
    opacity: 1;
}

.auth-input-error {
    font-size: 0.8rem;
}
</style>
