<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AccountPending from '@greybots/common/components/AccountPending.vue';
import { supabase } from '@greybots/common/supabase/client';
import { useAuthStore } from '@/stores/auth-store';

// Where a signed-in account with no scouting role lands (issue #112): a new
// account waiting for a lead or admin to approve it, or a deactivated one.
const router = useRouter();
const authStore = useAuthStore();
const checking = ref(false);

// The router sends them on to their schedule once they've been given a role.
async function refresh() {
    checking.value = true;
    try {
        await authStore.checkUser();
        if (authStore.hasAccess) router.push('/schedule');
    } finally {
        checking.value = false;
    }
}

async function signOut() {
    await supabase.auth.signOut();
    await authStore.checkUser();
    router.push('/login');
}
</script>

<template>
    <div class="main-content">
        <div class="login-tile">
            <AccountPending
                app-name="GreyScout"
                :name="authStore.currentUserName"
                :deactivated="authStore.isDeactivated"
                :checking="checking"
                @refresh="refresh"
                @sign-out="signOut"
            />
        </div>
    </div>
</template>
