// TODO: fix types
// @ts-nocheck

import { isSiteReadPrivate, isSiteWritePrivate } from "@/lib/constants";

import { createRouter, createWebHistory } from "vue-router";
import DataUploadView from "@/views/DataUploadView.vue";
import MatchScoutView from "@/views/MatchScoutView.vue";
import MatchDataEditView from "@/views/MatchDataEditView.vue";
import PitScoutingView from "@/views/PitScoutingView.vue";
import PreScoutView from "@/views/PreScoutView.vue";
import StatsView from "@/views/StatsView.vue";
import TeamAnalysisView from "@/views/TeamAnalysisView.vue";
import EventAnalysisView from "@/views/EventAnalysisView.vue";
import StrategyView from "@/views/StrategyView.vue";
import CustomDataVisualizationView from "@/views/CustomDataVisualizationView.vue";
import LoginView from "@/views/LoginView.vue";
import RegisterView from "@/views/RegisterView.vue";
import ResetPasswordView from "@/views/ResetPasswordView.vue";
import AccountView from "@/views/AccountView.vue";
import PicklistView from "@/views/PicklistView.vue";
import PickEmView from "@/views/PickEmView.vue";
import PlayoffsView from "@/views/PlayoffsView.vue";
import DataStatusView from "@/views/DataStatusView.vue";
import ScoutScheduleView from "@/views/ScoutScheduleView.vue";
import { useAuthStore, roleRank } from "@/stores/auth-store";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "Home | GreyScout",
      component: LoginView
    },
    {
      path: "/upload",
      name: "Data Upload | GreyScout",
      component: DataUploadView,
      meta: {
        requiresAuth: isSiteWritePrivate
      }
    },
    {
      path: "/event",
      name: "Event Analysis | GreyScout",
      component: EventAnalysisView,
      meta: {
        requiresAuth: isSiteReadPrivate
      }
    },
    {
      path: "/match",
      name: "Match Scouting | GreyScout",
      component: MatchScoutView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'member'
      }
    },
    {
      // Edit an existing match-scouting submission (issue #31) — reached
      // from Data Status, lead/admin only.
      path: "/match/edit/:id",
      name: "Edit Match Data | GreyScout",
      component: MatchDataEditView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'lead'
      }
    },
    {
      // Optional team-number segment (issue #46) so a specific team's page
      // is directly linkable/bookmarkable — bare /team still works and
      // falls back to whichever team the view picks by default.
      path: "/team/:teamNumber?",
      name: "Team Analysis | GreyScout",
      component: TeamAnalysisView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'observer'
      }
    },
    {
      path: "/pit",
      name: "Pit Scouting | GreyScout",
      component: PitScoutingView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'member'
      }
    },
    {
      path: "/prescout",
      name: "Prescouting | GreyScout",
      component: PreScoutView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'member'
      }
    },
    {
      path: "/stats",
      name: "Stats | GreyScout",
      component: StatsView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'observer'
      }
    },
    {
      path: "/event",
      name: "Event Analysis | GreyScout",
      component: EventAnalysisView,
      meta: {
        requiresAuth: isSiteReadPrivate
      }
    },
    {
      path: "/strategy",
      name: "Strategy | GreyScout",
      component: StrategyView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'lead'
      }
    },
    {
      path: "/chartbuilder",
      name: "Chart Builder | GreyScout",
      component: CustomDataVisualizationView,
      meta: {
        requiresAuth: isSiteReadPrivate
      }
    },
    {
      path: "/login",
      name: "Login | GreyScout",
      component: LoginView,
    },
    {
      path: "/register",
      name: "Register | GreyScout",
      component: RegisterView,
    },
    {
      path: "/reset-password",
      name: "Reset Password | GreyScout",
      component: ResetPasswordView,
    },
    {
      path: "/account",
      name: "Account | GreyScout",
      component: AccountView,
      meta: {
        requiresAuth: true
      }
    },
    {
      path: "/picklist",
      name: "Pick List | GreyScout",
      component: PicklistView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'member'
      }
    },
    {
      path: "/pickem",
      name: "Pick'em | GreyScout",
      component: PickEmView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'member'
      }
    },
    {
      path: "/playoffs",
      name: "Playoffs | GreyScout",
      component: PlayoffsView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'observer'
      }
    },
    {
      path: "/data-status",
      name: "Data Status | GreyScout",
      component: DataStatusView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'observer'
      }
    },
    {
      path: "/schedule",
      name: "Schedule | GreyScout",
      component: ScoutScheduleView,
      meta: {
        requiresAuth: isSiteReadPrivate,
        minRole: 'member'
      }
    }
  ],
});

router.beforeEach(async (to, from, next) => {
  let authStore = useAuthStore();

  // Prevent unauthorized users from accessing the app if the app is private.
  if (isSiteReadPrivate) {
    await authStore.checkUser();
  }

  if (isSiteReadPrivate && to.meta.requiresAuth && !authStore.isUserLoggedIn) {
    next('/login');
    return;
  }

  if (to.meta.minRole) {
    const rank = authStore.role ? roleRank[authStore.role] : -1;
    if (rank < roleRank[to.meta.minRole]) {
      // Every role can reach Data Status — redirecting there (rather than
      // "/", which renders a login form even for an already-logged-in user)
      // avoids a confusing re-login prompt for someone who's just lacking
      // a permission, not a session.
      next('/data-status');
      return;
    }
  }

  document.title = to.name;
  next();
});

export default router;
