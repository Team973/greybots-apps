<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";
import "@material/web/button/text-button";
import AuthInput from '@greybots/common/components/AuthInput.vue';
import { readFormValues } from '@greybots/common/lib/account';

import { supabase } from "@greybots/common/supabase/client";

import { hubForgotPasswordUrl } from '@greybots/common/lib/hub';

import { useAuthStore } from "@/stores/auth-store";
</script>

<template>
    <div class="main-content">
        <!-- Real forms with native inputs, so autofill and password managers
             work; the values are read from the form when it's submitted. -->
        <form class="login-tile" @submit.prevent="logInUser($event)">
            <h1 class="login-tile-element">Log in</h1>
            <div class="login-tile-element login-field">
                <AuthInput :model-value="userEmail" @update:modelValue="updateEmail" label="Email" :error="emailError"
                    type="email" name="email" autocomplete="username" />
            </div>
            <div class="login-tile-element login-field">
                <AuthInput :model-value="userPassword" @update:modelValue="updatePassword" label="Password"
                    :error="passwordError" type="password" name="password" autocomplete="current-password" />
            </div>
            <div class="login-tile-element" v-if="formError">
                <p class="form-error">{{ formError }}</p>
            </div>
            <div class="login-tile-element">
                <md-filled-button type="submit" class="load-button">Log in</md-filled-button>
            </div>
            <div class="login-tile-element">
                <!-- Passwords are reset on the hub, which comes back here after. -->
                <md-text-button type="button" v-on:click="forgotPassword()">Forgot password?</md-text-button>
            </div>
            <div class="login-tile-element">
                <md-text-button type="button" v-on:click="$router.push('/register')">Need an account? Register</md-text-button>
            </div>
        </form>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            userEmail: "",
            userPassword: "",
            emailError: false,
            passwordError: false,
            formError: "",
            authStore: null,
        }
    },
    methods: {
        updateEmail(text) {
            this.userEmail = text;
            this.emailError = (this.userEmail == "");
        },
        updatePassword(text) {
            this.userPassword = text;
            this.passwordError = (this.userPassword == "");
        },
        async logInUser(event) {
            this.formError = "";
            // Read the fields from the form itself: autofill and password
            // managers can fill them without an input event, which used to
            // leave them "required" while visibly filled in.
            if (event?.target instanceof HTMLFormElement) {
                const values = readFormValues(event.target);
                this.userEmail = values.email ?? this.userEmail;
                this.userPassword = values.password ?? this.userPassword;
            }
            this.emailError = (this.userEmail == "");
            this.passwordError = (this.userPassword == "");
            if (this.emailError || this.passwordError) {
                return;
            }

            const { data, error } = await supabase.auth.signInWithPassword({
                email: this.userEmail,
                password: this.userPassword,
            });

            if (error) {
                this.formError = error.message;
                return;
            }

            await this.authStore.checkUser();
            this.$router.push(this.authStore.role === 'member' ? '/schedule' : '/picklist');
        },
        forgotPassword() {
            window.location.assign(hubForgotPasswordUrl(`${window.location.origin}/login`));
        },
        // Supabase redirects here with error params in the URL (hash for the
        // implicit flow, query string for PKCE) when a confirmation/recovery
        // link fails server-side — e.g. an email link scanner pre-visiting and
        // burning the one-time token before the user clicks it, or the link
        // simply expiring. Surface that instead of showing a blank login form.
        checkAuthCallbackError() {
            const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
            const queryParams = new URLSearchParams(window.location.search);
            const errorCode = hashParams.get('error_code') || queryParams.get('error_code');
            const errorDescription = hashParams.get('error_description') || queryParams.get('error_description');
            const error = hashParams.get('error') || queryParams.get('error');

            if (!error && !errorCode) {
                return;
            }

            this.formError = errorCode === 'otp_expired'
                ? "This confirmation link is invalid or has expired. Please ask an admin to resend it, or register again."
                : (errorDescription ? errorDescription.replace(/\+/g, ' ') : "Something went wrong confirming your email. Please try again or contact an admin.");

            // Drop the error params from the URL so refreshing doesn't re-show them.
            window.history.replaceState(null, '', window.location.pathname);
        }
    },
    created() {
        this.authStore = useAuthStore();
        this.checkAuthCallbackError();
    }
}
</script>

<style scoped>
.login-tile-element {
    padding: 15px;
}

.login-field {
    width: 100%;
    max-width: 360px;
    box-sizing: border-box;
}

.form-error {
    color: #c0392b;
    margin: 0;
}
</style>