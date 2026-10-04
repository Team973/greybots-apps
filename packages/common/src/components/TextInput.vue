<template>
    <md-outlined-text-field ref="field" v-on:input="updateText" v-on:change="updateText" :type="type"
        v-bind:value="modelValue" :label="label" :name="name" :autocomplete="autocomplete" :required="required"
        :error="error" error-text="This field is required"></md-outlined-text-field>
</template>

<script lang="ts">
// @ts-nocheck
import "@material/web/textfield/outlined-text-field";

// Deliberately not <script setup>: that closes a component, hiding its methods
// from a parent's template ref, and forms call readValue() through one.
export default {
    props: {
        modelValue: {
            required: true
        },
        label: {
            default: ""
        },
        required: {
            default: false
        },
        error: {
            default: false
        },
        type: {
            default: "text"
        },
        // Passed to the field so browsers and password managers know what
        // to fill in (e.g. "email", "current-password").
        name: {
            type: String,
            default: undefined
        },
        autocomplete: {
            type: String,
            default: undefined
        }
    },
    computed: {
        currentNumber() {
            return this.modelValue;
        }
    },
    methods: {
        updateText(event) {
            this.$emit('update:modelValue', event.target.value);
        },
        // What's in the field right now, read from the page rather than from
        // the last input event. Autofill and password managers (Firefox's in
        // particular) can fill a field without firing one, which leaves the
        // bound value empty while the field shows text. Forms call this when
        // they're submitted.
        readValue() {
            const field = this.$refs.field;
            const inner = field?.shadowRoot?.querySelector('input, textarea');
            const value = inner?.value || field?.value || this.modelValue || '';
            if (value !== this.modelValue) this.$emit('update:modelValue', value);
            return value;
        }
    }
}
</script>
