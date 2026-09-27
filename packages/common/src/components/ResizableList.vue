<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";

</script>

<template>
    <div v-for="item, i in itemList">
        <slot name="item-content" :index="i">
        </slot>

        <md-filled-button v-on:click="removeItem(i)" class="load-button">x</md-filled-button>
    </div>
    <div>
        <md-filled-button v-on:click="addItem()" class="load-button">Add {{ itemTypeName }}</md-filled-button>
    </div>
</template>


<script lang="ts">
export default {
    props: {
        itemList: {
            default: []
        },
        itemTypeName: {
            default: "item"
        }
    },
    emits: ["item-removed", "item-added"],
    methods: {
        removeItem(index: number) {
            this.$emit("item-removed", index);
        },
        addItem() {
            this.$emit("item-added", true)
        },
    }
}
</script>


<style scoped></style>