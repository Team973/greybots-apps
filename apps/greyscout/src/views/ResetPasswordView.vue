<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";
import TextInput from '@greybots/common/components/TextInput.vue';

import { supabase } from "@greybots/common/supabase/client";

import { useAuthStore } from "@/stores/auth-store";
</script>

<template>
    <div class="main-content">
        <div class="login-tile">
            <h1 class="login-tile-element">Choose a new password</h1>
            <div class="login-tile-element">
                <TextInput :model-value="newPassword" @update:modelValue="updateNewPassword" label="New password"
                    required="true" :error="newPasswordError" type="password">
                </TextInput>
            </div>
            <div class="login-tile-element">
                <TextInput :model-value="newPasswordConfirm" @update:modelValue="updateNewPasswordConfirm"
                    @keyup.enter="updatePassword" label="Confirm new password" required="true"
                    :error="newPasswordConfirmError" type="password">
                </TextInput>
            </div>
            <div class="login-tile-element" v-if="formError">
                <p class="form-error">{{ formError }}</p>
            </div>
            <div class="login-tile-element" v-if="formSuccess">
                <p class="form-success">{{ formSuccess }}</p>
            </div>
            <div class="login-tile-element">
                <md-filled-button v-on:click="updatePassword()" class="load-button">Update password</md-filled-button>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            newPassword: "",
            newPasswordConfirm: "",
            newPasswordError: false,
            newPasswordConfirmError: false,
            formError: "",
            formSuccess: "",
            authStore: null,
        }
    },
    methods: {
        updateNewPassword(text) {
            this.newPassword = text;
            this.newPasswordError = (this.newPassword == "");
        },
        updateNewPasswordConfirm(text) {
            this.newPasswordConfirm = text;
            this.newPasswordConfirmError = (this.newPasswordConfirm == "");
        },
        async updatePassword() {
            this.formError = "";
            this.formSuccess = "";
            this.newPasswordError = (this.newPassword == "");
            this.newPasswordConfirmError = (this.newPasswordConfirm == "");

            if (this.newPasswordError || this.newPasswordConfirmError) {
                return;
            }

            if (this.newPassword !== this.newPasswordConfirm) {
                this.newPasswordConfirmError = true;
                this.formError = "Passwords do not match.";
                return;
            }

            const { error } = await supabase.auth.updateUser({ password: this.newPassword });

            if (error) {
                this.formError = error.message;
                return;
            }

            this.formSuccess = "Password updated. Redirecting to your account…";
            await this.authStore.checkUser();
            setTimeout(() => this.$router.push("/account"), 1500);
        }
    },
    created() {
        this.authStore = useAuthStore();
    }
}
</script>

<style scoped>
.login-tile-element {
    padding: 15px;
}

.form-error {
    color: #c0392b;
    margin: 0;
}

.form-success {
    color: #3a9e3a;
    margin: 0;
}
</style>
