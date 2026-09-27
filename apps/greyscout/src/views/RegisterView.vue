<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";
import "@material/web/button/text-button";
import TextInput from '@greybots/common/components/TextInput.vue';

import { supabase } from "@greybots/common/supabase/client";
import { userTable } from "@/lib/constants";

import { useAuthStore } from "@/stores/auth-store";
</script>

<template>
    <div class="main-content">
        <div class="login-tile">
            <h1 class="login-tile-element">Register</h1>
            <div class="login-tile-element">
                <TextInput :model-value="userName" @update:modelValue="updateName" label="Name" required="true"
                    :error="nameError">
                </TextInput>
            </div>
            <div class="login-tile-element">
                <TextInput :model-value="userEmail" @update:modelValue="updateEmail" label="Email" required="true"
                    :error="emailError">
                </TextInput>
            </div>
            <div class="login-tile-element">
                <TextInput :model-value="userPassword" @update:modelValue="updatePassword" label="Password"
                    required="true" :error="passwordError" type="password">
                </TextInput>
            </div>
            <div class="login-tile-element">
                <TextInput :model-value="userPasswordConfirm" @update:modelValue="updatePasswordConfirm"
                    @keyup.enter="registerUser" label="Confirm Password" required="true"
                    :error="passwordConfirmError" type="password">
                </TextInput>
            </div>
            <div class="login-tile-element" v-if="formError">
                <p class="form-error">{{ formError }}</p>
            </div>
            <div class="login-tile-element" v-if="formSuccess">
                <p class="form-success">{{ formSuccess }}</p>
            </div>
            <div class="login-tile-element">
                <md-filled-button v-on:click="registerUser()" class="load-button">Register</md-filled-button>
            </div>
            <div class="login-tile-element">
                <md-text-button v-on:click="$router.push('/login')">Already have an account? Log in</md-text-button>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            userName: "",
            userEmail: "",
            userPassword: "",
            userPasswordConfirm: "",
            nameError: false,
            emailError: false,
            passwordError: false,
            passwordConfirmError: false,
            formError: "",
            formSuccess: "",
            authStore: null,
        }
    },
    methods: {
        updateName(text) {
            this.userName = text;
            this.nameError = (this.userName == "");
        },
        updateEmail(text) {
            this.userEmail = text;
            this.emailError = (this.userEmail == "");
        },
        updatePassword(text) {
            this.userPassword = text;
            this.passwordError = (this.userPassword == "");
        },
        updatePasswordConfirm(text) {
            this.userPasswordConfirm = text;
            this.passwordConfirmError = (this.userPasswordConfirm == "");
        },
        async registerUser() {
            this.formError = "";
            this.formSuccess = "";

            this.nameError = (this.userName == "");
            this.emailError = (this.userEmail == "");
            this.passwordError = (this.userPassword == "");
            this.passwordConfirmError = (this.userPasswordConfirm == "");

            if (this.nameError || this.emailError || this.passwordError || this.passwordConfirmError) {
                return;
            }

            if (this.userPassword !== this.userPasswordConfirm) {
                this.passwordConfirmError = true;
                this.formError = "Passwords do not match.";
                return;
            }

            const { data, error } = await supabase.auth.signUp({
                email: this.userEmail,
                password: this.userPassword,
                options: {
                    data: {
                        name: this.userName
                    },
                    emailRedirectTo: `${window.location.origin}/login`
                }
            });

            if (error) {
                this.formError = error.message;
                return;
            }

            // If a session was returned immediately (email confirmation disabled),
            // create the profile row now. Otherwise it will be provisioned on first
            // login, once the user has a session and can satisfy the insert policy.
            if (data.session && data.user) {
                await supabase.from(userTable).insert({
                    user_id: data.user.id,
                    name: this.userName,
                    role: 'observer'
                });

                await this.authStore.checkUser();
                this.$router.push("/event");
                return;
            }

            this.formSuccess = "Check your email to confirm your account, then log in.";
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
