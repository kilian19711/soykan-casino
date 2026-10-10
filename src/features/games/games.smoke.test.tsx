// Rendert jedes neue Spiel mit seiner echten Konfiguration aus der Migration (Smoke-Test gegen Laufzeitfehler).
/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Suspense } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../lib/api', () => ({
  api: {
    getMyRounds: vi.fn(async () => []),
    getActiveRound: vi.fn(async () => null),
    getGameLimits: vi.fn(async () => ({ max_win_per_round: 100000 })),
    getGameConfigs: vi.fn(async () => []),
    playGame: vi.fn(),
    stepStart: vi.fn(),
    stepAction: vi.fn(),
    stepCashout: vi.fn(),
  },
}));
vi.mock('../../app/AppData', () => ({
  useAppData: () => ({ balance: 5000, applyServerBalance: () => undefined, dashboard: null }),
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));

import { ToastProvider } from '../../components/Toast';
import * as Wheel from './games/WheelGames';
import * as Cards from './games/CardGames';
import * as Lottery from './games/LotteryGames';
import * as Slots from './games/SlotGames';
import * as Dice from './games/DiceGames';
import * as Grid from './games/GridGames';
import * as Sticky from './games/StickyDiamonds';
import type { GameConfig } from '../../types';

const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261009000006_more_games.sql'), 'utf8');
const configs: Record<string, GameConfig> = {};
const sql8 = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261009000008_shisha_diamonds_v2.sql'), 'utf8');
for (const m of sql.matchAll(/\('([a-z_]+)', '([^']+)', true, '(\{[\s\S]*?\})'\)/g)) {
  configs[m[1]] = { game_key: m[1], display_name: m[2], enabled: true, config: JSON.parse(m[3]) };
}
configs.shisha_diamonds = { ...configs.shisha_diamonds, config: JSON.parse(/set config = '(\{[\s\S]*?\})'::jsonb/.exec(sql8)![1]) };

const COMPONENTS: Record<string, React.ComponentType<{ config: GameConfig }>> = {
  coinflip: Wheel.Coinflip, wheel: Wheel.Wheel, color_wheel: Wheel.ColorWheel, bonus_wheel: Wheel.BonusWheel,
  goal_multiplier: Wheel.GoalMultiplier, rocket_multiplier: Wheel.RocketMultiplier, safe_cracker: Wheel.SafeCracker, drop_ball: Wheel.DropBall,
  baccarat: Cards.Baccarat, dragon_tiger: Cards.DragonTiger, andar_bahar: Cards.AndarBahar, card_duel: Cards.CardDuel, hilo: Cards.HiLo, video_poker: Cards.VideoPoker,
  keno: Lottery.Keno, number_draw: Lottery.NumberDraw, digital_lottery: Lottery.DigitalLottery, bingo: Lottery.Bingo, scratch_card: Lottery.ScratchCard,
  classic_slots: Slots.ClassicSlots, fruit_slots: Slots.FruitSlots, neon_slots: Slots.NeonSlots, cluster_slots: Slots.ClusterSlots,
  lucky_seven: Slots.LuckySeven, shisha_diamonds: Sticky.ShishaDiamonds,
  sicbo: Dice.SicBo, poker_dice: Dice.PokerDice, dice_duel: Dice.DiceDuel,
  towers: Grid.Towers, gem_hunt: Grid.GemHunt, treasure_grid: Grid.TreasureGrid,
};

describe('Neue Spiele', () => {
  it('Migration enthält Konfigurationen für alle 31 neuen Spiele', () => {
    expect(Object.keys(COMPONENTS).length).toBe(31);
    for (const k of Object.keys(COMPONENTS)) expect(configs[k], k).toBeDefined();
  });
  for (const [key, Comp] of Object.entries(COMPONENTS)) {
    it(`rendert ${key}`, () => {
      render(
        <MemoryRouter>
          <ToastProvider>
            <Suspense fallback={null}>
              <Comp config={configs[key]} />
            </Suspense>
          </ToastProvider>
        </MemoryRouter>,
      );
      expect(screen.getByRole('heading', { level: 1, name: configs[key].display_name })).toBeInTheDocument();
    });
  }
});
