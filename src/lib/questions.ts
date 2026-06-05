/**
 * Build the question set for a scan. The app always asks hunger first, then
 * appends the menu-aware questions the Vision call wrote (menu_context.dimensions).
 */
import type { Question, VisionMenuContext } from './types';

export const HUNGER_QUESTION: Question = {
  id: 'hunger',
  question_text: 'How hungry are you feeling right now?',
  options: [
    { label: 'Light bite', value: 'light', emoji: '🥗' },
    { label: 'Medium', value: 'medium', emoji: '🍽️' },
    { label: 'Starving', value: 'starving', emoji: '🔥' },
  ],
};

export function buildQuestions(menuContext: VisionMenuContext): Question[] {
  return [HUNGER_QUESTION, ...menuContext.dimensions];
}
