<script setup lang="ts">
// @ts-nocheck
import "@material/web/textfield/outlined-text-field";
import { useViewModeStore } from '../stores/view-mode-store';
</script>

<template>
    <md-outlined-text-field v-on:input="updateText" type="textarea" v-bind:value="modelValue" :label="label" :cols="cols"
        :rows="effectiveRows" :maxLength="maxLength" :required="required" :error="error"
        error-text="This field is required"></md-outlined-text-field>
</template>

<script lang="ts">
export default {
    props: {
        modelValue: {
            required: true
        },
        label: {
            default: ""
        },
        cols: {
            default: 100
        },
        // Explicit override — leave unset to size responsively (bigger on mobile).
        rows: {
            default: null
        },
        maxLength: {
            default: 2000
        },
        required: {
            default: false
        },
        error: {
            default: false
        }
    },
    data() {
        return {
            viewMode: null
        }
    },
    computed: {
        currentNumber() {
            return this.modelValue;
        },
        effectiveRows() {
            if (this.rows != null) {
                return this.rows;
            }
            return this.viewMode?.isMobile ? 6 : 2;
        }
    },
    methods: {
        updateText(event) {
            this.$emit('update:modelValue', event.target.value);
        }
    },
    created() {
        this.viewMode = useViewModeStore();
    }
}
</script>