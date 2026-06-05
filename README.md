# plAIt 🍽️

Photograph a restaurant menu, get your three best dishes — personalized to a
hardcoded profile (halal, shellfish-free, high-protein by default). Single-user
demo built with Expo + Claude. No accounts, no database, no deployment.

**The loop:** hardcoded profile → camera → Claude Vision reads the menu →
menu-aware questions → Claude ranks the top 3.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your Anthropic API key. Copy `.env.example` to `.env` and fill it in:

   ```bash
   cp .env.example .env
   ```

   > **Important (Expo):** the variable **must** be named
   > `EXPO_PUBLIC_ANTHROPIC_API_KEY`. Expo only inlines env vars prefixed with
   > `EXPO_PUBLIC_` into the app bundle — a bare `ANTHROPIC_API_KEY` is
   > `undefined` at runtime in Expo Go. Restart the dev server after editing
   > `.env`.

3. Start the app and open it in Expo Go on your phone:

   ```bash
   npx expo start
   ```

## Edit your profile

The demo profile lives in `src/config/profile.ts` — edit it directly to demo
different scenarios (goals, dietary restrictions, allergens).

## Project layout

| Path | What |
| --- | --- |
| `src/config/profile.ts` | Hardcoded demo profile |
| `src/lib/callVision.ts` | Claude Vision — reads the menu into items + menu_context |
| `src/lib/questions.ts` | Fixed hunger question + Vision-written menu questions |
| `src/lib/callReason.ts` | Claude reasoning — ranks the top 3 picks |
| `src/app/` | Screens: `index` (home), `camera`, `questions`, `results` |

## Testing

End-to-end against a real menu photo (uses your API key):

```bash
npx tsx scripts/test-pipeline.ts ./test-menu.jpg
```
