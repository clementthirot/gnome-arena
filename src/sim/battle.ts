// Moteur de combat : boucle à pas fixe, sans aucune dépendance au rendu.
// Même données + même seed = même combat, tick pour tick.
import type { ArenaEventDef, AttackDef, EffectDef, EquipmentDef, GameData, HeroDef, TeamId, UnitDef } from '../data/schema';
import { runEffects, type EffectContext, type EffectHost } from './effects';
import { cos, hypot, nthRoot, sin } from './detmath';
import { SpatialGrid } from './grid';
import { Rng, hashSeed } from './rng';
import type { BattleEvent, BattleResult, FieldRect, Projectile, Unit } from './types';

export const TEAMS: readonly TeamId[] = ['gnomes', 'goblins'];

export interface BattleSetup {
  seed: string | number;
  /** Héros engagés ; par défaut, tous les héros actifs des données. */
  heroes?: readonly HeroDef[];
  /** Upgrades gagnées en cours d'arc, par identifiant de héros (s'ajoutent à heroes[].upgrades). */
  upgrades?: Readonly<Record<string, readonly string[]>>;
}

interface PendingIncident {
  def: ArenaEventDef;
  x: number;
  y: number;
  /** Point de départ des projectiles (dans les gradins). */
  fromX: number;
  fromY: number;
  at: number;
}

export interface StrengthSample {
  t: number;
  gnomes: number;
  goblins: number;
}

const other = (team: TeamId): TeamId => (team === 'gnomes' ? 'goblins' : 'gnomes');

export class Battle implements EffectHost {
  readonly dt: number;
  readonly seed: number;
  readonly units: Unit[] = [];
  readonly projectiles: Projectile[] = [];
  /** Événements du dernier tick uniquement. */
  events: BattleEvent[] = [];
  /** Force restante de chaque camp (PV restants / PV initiaux), échantillonnée chaque seconde. */
  readonly history: StrengthSample[] = [];
  readonly field: FieldRect;
  zone: FieldRect;
  zoneScale = 1;
  time = 0;
  tick = 0;
  result: BattleResult | null = null;

  private readonly rng: Rng;
  private readonly decayPerTick: number;
  private readonly grid = new SpatialGrid<Unit>(16);
  private readonly attackers: number[] = [];
  private readonly wanderAngle: number[] = [];
  private readonly initialHp: Record<TeamId, number> = { gnomes: 0, goblins: 0 };
  /** Bonus de dégâts du camp mené, recalculé à chaque tick (voir rules.underdog). */
  readonly fury: Record<TeamId, number> = { gnomes: 0, goblins: 0 };
  private nextProjectileId = 0;
  /** Plus grand rayon d'unité : borne les recherches dans la grille. */
  maxRadius = 0;
  private nextIncidentAt = -1;
  private readonly pendingIncidents: PendingIncident[] = [];
  private readonly extraUpgrades: Readonly<Record<string, readonly string[]>>;
  private zoneAnnounced = false;

  constructor(
    readonly data: GameData,
    setup: BattleSetup,
  ) {
    this.dt = 1 / data.battle.tickRate;
    this.seed = hashSeed(setup.seed);
    this.rng = new Rng(this.seed);
    // knockbackDecay est par seconde ; on en déduit la part conservée à chaque tick.
    this.decayPerTick = nthRoot(data.battle.rules.knockbackDecay, data.battle.tickRate);
    this.field = { ...data.battle.arena.field };
    this.zone = { ...this.field };
    this.extraUpgrades = setup.upgrades ?? {};
    this.spawnArmies(setup.heroes ?? data.heroes.filter((h) => h.active));
    this.sampleStrength();
  }

  // ---------------------------------------------------------------- mise en place

  private spawnArmies(heroes: readonly HeroDef[]): void {
    for (const team of TEAMS) {
      const roster: { def: UnitDef; hero?: HeroDef }[] = [];
      for (const [unitId, count] of Object.entries(this.data.battle.armies[team] ?? {})) {
        const def = this.unitDef(unitId);
        for (let i = 0; i < count; i++) roster.push({ def });
      }
      for (const hero of heroes) {
        const def = this.unitDef(hero.base);
        if (def.team === team) roster.push({ def, hero });
      }
      this.placeArmy(team, roster);
    }
  }

  /** Gnomes en bas, gobelins en haut ; mêlée devant, tireurs derrière, en rangs lâches. */
  private placeArmy(team: TeamId, roster: { def: UnitDef; hero?: HeroDef }[]): void {
    const f = this.field;
    const depthOf = (def: UnitDef) => {
      const role = this.role(def.role);
      if (role.keepDistance > 0) return 2;
      return role.charge ? 1 : 0;
    };
    const rows: { def: UnitDef; hero?: HeroDef }[][] = [[], [], []];
    for (const entry of roster) rows[depthOf(entry.def)].push(entry);

    const front = team === 'gnomes' ? f.y + f.height * 0.64 : f.y + f.height * 0.36;
    const back = team === 'gnomes' ? 1 : -1;
    // Un rang ne dépasse pas la largeur du terrain : au-delà, on ouvre un rang de plus derrière.
    const perLine = Math.max(4, Math.floor(f.width / 14));
    let offset = 0;
    rows.forEach((row) => {
      if (row.length === 0) return;
      // Les héros sont répartis dans le rang plutôt qu'empilés au bout.
      const ordered = [...row];
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
      for (let start = 0; start < ordered.length; start += perLine) {
        const line = ordered.slice(start, start + perLine);
        line.forEach((entry, i) => {
          const x = f.x + ((i + 0.5) / line.length) * f.width + this.rng.range(-4, 4);
          const y = front + back * (offset + (i % 2) * 5) + this.rng.range(-3, 3);
          this.createUnit(team, entry.def, x, y, entry.hero);
        });
        offset += 13;
      }
      offset += 8;
    });
  }

  private createUnit(team: TeamId, def: UnitDef, x: number, y: number, hero?: HeroDef): void {
    const s = hero?.stats;
    const equipment: EquipmentDef[] = hero
      ? [...hero.upgrades, ...(this.extraUpgrades[hero.id] ?? [])].map((id) => this.data.equipment.find((e) => e.id === id)!).filter(Boolean)
      : [];
    const gear = (key: 'hp' | 'damage' | 'speed' | 'mass') => equipment.reduce((m, e) => m * e.stats[key], 1);
    const personalityId = hero ? hero.personality : this.rng.weighted(def.personalities);
    const personality = this.data.personalities.find((p) => p.id === personalityId)!;
    const role = this.role(def.role);
    const maxHp = def.hp * (s?.hp ?? 1) * gear('hp');
    const unit: Unit = {
      index: this.units.length,
      team,
      defId: def.id,
      visual: hero?.visual ?? def.visual,
      role,
      personality,
      hero: hero && { id: hero.id, name: hero.name, label: hero.label },
      radius: def.radius * (s?.size ?? 1),
      mass: def.mass * (s?.mass ?? 1) * gear('mass'),
      maxHp,
      damage: def.damage * (s?.damage ?? 1) * gear('damage'),
      speed: def.speed * (s?.speed ?? 1) * personality.speedFactor * gear('speed'),
      equipment,
      x,
      y,
      vx: 0,
      vy: 0,
      kx: 0,
      ky: 0,
      facing: team === 'gnomes' ? 1 : -1,
      hp: maxHp,
      morale: 1,
      state: 'choose',
      target: -1,
      retargetIn: this.rng.range(...this.data.battle.rules.retargetInterval),
      attackCooldowns: role.attacks.map(() => this.rng.range(0, 1)),
      stateTimer: 0,
      charging: false,
      chargeCooldown: this.rng.range(0, 3),
      chargeDir: { x: 0, y: 0 },
      rushTimer: 0,
      blockedTime: 0,
      lastGap: Infinity,
      specialCooldowns: equipment.map(() => this.rng.range(1, 3)),
      slowUntil: 0,
      slowFactor: 1,
      kills: 0,
      damageDealt: 0,
      deathTime: -1,
    };
    this.units.push(unit);
    this.maxRadius = Math.max(this.maxRadius, unit.radius);
    this.attackers.push(0);
    this.wanderAngle.push(this.rng.range(0, Math.PI * 2));
    this.initialHp[team] += maxHp;
  }

  private unitDef(id: string): UnitDef {
    return this.data.units.find((u) => u.id === id)!;
  }

  private role(id: string) {
    return this.data.roles.find((r) => r.id === id)!;
  }

  // ---------------------------------------------------------------- boucle

  /** Avance la simulation d'un tick. Sans effet une fois le combat terminé. */
  step(): void {
    if (this.result) return;
    this.events = [];
    this.time += this.dt;
    this.tick++;

    this.updateZone();
    this.grid.rebuild(this.units, (u) => u.state !== 'dead');
    this.countAttackers();
    this.updateFury();
    for (const u of this.units) if (u.state !== 'dead') this.think(u);
    for (const u of this.units) this.move(u);
    this.updateProjectiles();
    this.updateIncidents();
    if (this.tick % this.data.battle.tickRate === 0) this.sampleStrength();
    this.checkEnd();
  }

  /** Simule jusqu'à la fin (mode accéléré). */
  runToEnd(): BattleResult {
    while (!this.result) this.step();
    return this.result;
  }

  alive(team?: TeamId): Unit[] {
    return this.units.filter((u) => u.state !== 'dead' && (!team || u.team === team));
  }

  strength(team: TeamId): number {
    let hp = 0;
    for (const u of this.units) if (u.team === team && u.state !== 'dead') hp += u.hp;
    return hp / this.initialHp[team];
  }

  // ---------------------------------------------------------------- décisions

  private think(u: Unit): void {
    const dt = this.dt;
    const rules = this.data.battle.rules;
    const p = u.personality;
    for (let i = 0; i < u.attackCooldowns.length; i++) u.attackCooldowns[i] -= dt;
    for (let i = 0; i < u.specialCooldowns.length; i++) u.specialCooldowns[i] -= dt;
    u.chargeCooldown -= dt;
    u.retargetIn -= dt;
    u.rushTimer -= dt;
    u.morale = Math.min(1, u.morale + rules.moraleRegen * dt);

    // Fuite : on court loin de l'ennemi le plus proche jusqu'à reprendre ses esprits.
    if (u.state === 'flee') {
      u.stateTimer -= dt;
      if (u.stateTimer <= 0) {
        u.state = 'choose';
        u.morale = Math.max(u.morale, p.panicThreshold + 0.3);
      } else {
        this.steerFlee(u);
        return;
      }
    }
    if (u.morale < p.panicThreshold && this.rng.chance(p.panicChance * dt)) {
      u.state = 'flee';
      u.charging = false;
      u.stateTimer = this.rng.range(...rules.panicDuration);
      this.releaseTarget(u);
      this.events.push({ type: 'panic', unit: u.index });
      this.steerFlee(u);
      return;
    }
    // Tendance, pas règle : même un peureux peut se jeter dans la mêlée.
    if (u.rushTimer <= 0 && this.rng.chance(p.recklessChance * dt)) {
      u.rushTimer = this.rng.range(2, 4);
      if (u.role.keepDistance > 0 || p.distanceFactor > 1) this.events.push({ type: 'rush', unit: u.index });
    }

    let target = u.target >= 0 ? this.units[u.target] : undefined;
    if (!target || target.state === 'dead') {
      target = this.chooseTarget(u);
    } else if (this.occupiesSlot(u) && this.attackers[target.index] > rules.maxAttackersPerTarget && !u.charging && this.rng.chance(2 * this.dt)) {
      // Cible surchargée : on va chercher quelqu'un d'autre plutôt que de faire la queue.
      target = this.chooseTarget(u);
    } else if (u.retargetIn <= 0) {
      u.retargetIn = this.rng.range(...rules.retargetInterval);
      if (!u.charging && this.rng.chance(p.fickleness)) target = this.chooseTarget(u);
    }
    if (!target) {
      u.state = 'choose';
      u.vx = u.vy = 0;
      return;
    }

    const dx = target.x - u.x;
    const dy = target.y - u.y;
    const dist = hypot(dx, dy) || 0.001;
    const nx = dx / dist;
    const ny = dy / dist;
    const gap = dist - u.radius - target.radius;
    if (Math.abs(dx) > 1) u.facing = dx > 0 ? 1 : -1;

    // Bloqué derrière la foule sans progresser : on change de cible plutôt que de piétiner.
    if (u.state === 'approach' && !u.charging && gap >= u.lastGap - 0.02) u.blockedTime += dt;
    else u.blockedTime = 0;
    u.lastGap = gap;
    if (u.blockedTime > 1.5) {
      u.blockedTime = 0;
      u.lastGap = Infinity;
      const next = this.chooseTarget(u, target.index);
      if (next) return;
    }

    if (u.charging) {
      this.updateCharge(u);
      return;
    }
    const charge = u.role.charge;
    if (charge && u.chargeCooldown <= 0 && gap >= charge.minDistance && gap <= charge.maxDistance && this.rng.chance(1.5 * dt)) {
      u.charging = true;
      u.stateTimer = charge.duration;
      u.chargeDir = { x: nx, y: ny };
      u.state = 'approach';
      this.events.push({ type: 'charge', unit: u.index });
      this.updateCharge(u);
      return;
    }

    // Déplacement : garder ses distances (tireurs), sinon aller au contact.
    const keep = u.rushTimer > 0 ? 0 : u.role.keepDistance * p.distanceFactor;
    const ranged = u.role.attacks.find((a) => a.kind === 'ranged');
    const melee = u.role.attacks.find((a) => a.kind === 'melee');
    let speed = 0;
    let dirX = nx;
    let dirY = ny;
    if (keep > 0 && gap < keep * 0.75) {
      // Recul, en glissant vers le centre quand un mur barre la route.
      const f = this.field;
      const cx = f.x + f.width / 2 - u.x;
      const cy = f.y + f.height / 2 - u.y;
      const cl = hypot(cx, cy) || 1;
      const wall = Math.max(0, 1 - Math.min(u.x - f.x, f.x + f.width - u.x, u.y - f.y, f.y + f.height - u.y) / 24);
      const rx = -nx + (cx / cl) * wall * 2;
      const ry = -ny + (cy / cl) * wall * 2;
      const rl = hypot(rx, ry) || 1;
      dirX = rx / rl;
      dirY = ry / rl;
      speed = u.speed * 0.85;
      // Acculé : il se retourne et se bat.
      if (wall > 0.7) u.rushTimer = Math.max(u.rushTimer, 1.5);
    } else if (keep > 0) {
      const holdMax = Math.max(keep + 12, (ranged?.maxRange ?? keep) * 0.85);
      if (gap > holdMax) speed = u.speed;
      else {
        // Tient sa position en se décalant latéralement.
        speed = u.speed * 0.35;
        dirX = -ny * u.facing;
        dirY = nx * u.facing;
      }
    } else if (gap > (melee?.maxRange ?? 2) * 0.7) {
      speed = u.speed;
    }
    u.vx = dirX * speed;
    u.vy = dirY * speed;

    if (this.trySpecial(u, target, gap)) return;
    const attackIndex = u.role.attacks.findIndex((a) => gap >= a.minRange && gap <= a.maxRange);
    u.state = attackIndex >= 0 ? 'attack' : 'approach';
    if (attackIndex >= 0 && u.attackCooldowns[attackIndex] <= 0) {
      const attack = u.role.attacks[attackIndex];
      u.attackCooldowns[attackIndex] = attack.cooldown * this.rng.range(0.85, 1.15);
      this.performAttack(u, target, attack, nx, ny, dist);
    }
  }

  private chooseTarget(u: Unit, avoid = -1): Unit | undefined {
    const rules = this.data.battle.rules;
    this.releaseTarget(u);
    let best: Unit | undefined;
    let bestScore = Infinity;
    for (const e of this.units) {
      if (e.team === u.team || e.state === 'dead') continue;
      let score = hypot(e.x - u.x, e.y - u.y) * (1 + this.rng.next() * rules.targetRandomness);
      if (this.attackers[e.index] >= rules.maxAttackersPerTarget && this.occupiesSlot(u)) score *= 4;
      if (e.state === 'flee') score *= 0.8; // les fuyards attirent les poursuivants
      if (e.index === avoid) score *= 3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    u.retargetIn = this.rng.range(...rules.retargetInterval);
    if (best) {
      u.target = best.index;
      this.attackers[best.index]++;
      u.state = 'approach';
    }
    return best;
  }

  private releaseTarget(u: Unit): void {
    if (u.target >= 0) this.attackers[u.target] = Math.max(0, this.attackers[u.target] - 1);
    u.target = -1;
  }

  /** Seuls les assaillants au corps à corps occupent une place autour de la cible ; les tireurs à distance non. */
  private occupiesSlot(u: Unit): boolean {
    return u.state !== 'dead' && u.state !== 'flee' && u.target >= 0 && (u.role.keepDistance === 0 || u.rushTimer > 0);
  }

  private countAttackers(): void {
    this.attackers.fill(0);
    for (const u of this.units) {
      if (this.occupiesSlot(u)) this.attackers[u.target]++;
    }
  }

  private steerFlee(u: Unit): void {
    let fx = 0;
    let fy = 0;
    this.grid.query(u.x, u.y, 70, (e) => {
      if (e.team === u.team) return;
      const dx = u.x - e.x;
      const dy = u.y - e.y;
      const d2 = dx * dx + dy * dy + 1;
      fx += dx / d2;
      fy += dy / d2;
    });
    const len = hypot(fx, fy);
    if (len < 1e-6) {
      // Personne autour : on court vers son côté du terrain.
      const homeY = u.team === 'gnomes' ? this.zone.y + this.zone.height : this.zone.y;
      fx = 0;
      fy = Math.sign(homeY - u.y) || 1;
    } else {
      fx /= len;
      fy /= len;
    }
    u.vx = fx * u.speed * 1.1;
    u.vy = fy * u.speed * 1.1;
    if (Math.abs(u.vx) > 1) u.facing = u.vx > 0 ? 1 : -1;
  }

  // ---------------------------------------------------------------- attaques

  private updateCharge(u: Unit): void {
    const charge = u.role.charge!;
    u.stateTimer -= this.dt;
    u.vx = u.chargeDir.x * u.speed * charge.speedMultiplier;
    u.vy = u.chargeDir.y * u.speed * charge.speedMultiplier;
    let hit: Unit | undefined;
    this.grid.query(u.x, u.y, u.radius + 14, (e) => {
      if (hit || e.team === u.team || e.state === 'dead') return;
      if (hypot(e.x - u.x, e.y - u.y) <= u.radius + e.radius + 1.5) hit = e;
    });
    if (hit) {
      const ix = (u.x + hit.x) / 2;
      const iy = (u.y + hit.y) / 2;
      this.events.push({ type: 'impact', unit: u.index, x: ix, y: iy });
      const victims: Unit[] = [];
      this.grid.query(ix, iy, charge.splashRadius + this.maxRadius, (e) => {
        if (e.team !== u.team && e.state !== 'dead' && hypot(e.x - ix, e.y - iy) <= charge.splashRadius + e.radius) victims.push(e);
      });
      for (const v of victims) {
        const main = v === hit;
        const ax = v.x - u.x;
        const ay = v.y - u.y;
        const al = hypot(ax, ay) || 1;
        // Mélange direction de charge et éloignement : la cible est projetée, les voisins écartés.
        const kx = u.chargeDir.x * 0.6 + (ax / al) * 0.4;
        const ky = u.chargeDir.y * 0.6 + (ay / al) * 0.4;
        const dmg = this.rollDamage(u, u.damage * charge.damage) * (main ? 1 : 0.5);
        this.applyDamage(v, dmg, u, kx, ky, charge.knockback * (main ? 1 : 0.7));
      }
      u.kx -= u.chargeDir.x * 40;
      u.ky -= u.chargeDir.y * 40;
      u.charging = false;
      u.chargeCooldown = charge.cooldown * this.rng.range(0.8, 1.3);
      u.attackCooldowns = u.attackCooldowns.map((c) => Math.max(c, 0.4));
    } else if (u.stateTimer <= 0) {
      u.charging = false;
      u.chargeCooldown = charge.cooldown * 0.5;
    }
  }

  private performAttack(u: Unit, target: Unit, attack: AttackDef, nx: number, ny: number, dist: number): void {
    this.events.push({ type: 'attack', unit: u.index, target: target.index, kind: attack.kind });
    const damage = this.rollDamage(u, u.damage * attack.damage);
    if (attack.kind === 'melee') {
      this.applyDamage(target, damage, u, nx, ny, attack.knockback);
      return;
    }
    // Tir : on vise la position actuelle, avec dispersion. La cible peut avoir bougé entre-temps.
    const speed = attack.projectileSpeed ?? 150;
    const angle = this.rng.range(0, Math.PI * 2);
    const offset = this.rng.next() * attack.spread;
    const toX = target.x + cos(angle) * offset;
    const toY = target.y + sin(angle) * offset;
    this.projectiles.push({
      id: this.nextProjectileId++,
      team: u.team,
      owner: u.index,
      attack,
      damage,
      visual: 'arrow',
      arc: Math.min(14, dist * 0.15),
      fromX: u.x,
      fromY: u.y,
      toX,
      toY,
      flightTime: Math.max(0.1, dist / speed),
      age: 0,
      x: u.x,
      y: u.y,
      done: false,
    });
  }

  /** @internal EffectHost */
  rollDamage(u: Unit, base: number): number {
    const fury = 1 + this.fury[u.team] * (u.hero ? this.data.battle.rules.underdog.heroFactor : 1);
    return base * fury * this.data.battle.rules.damageScale * this.rng.range(0.75, 1.25);
  }

  /** Rage du camp mené : plus l'écart de force est grand, plus il frappe fort. Empêche l'effet boule de neige. */
  private updateFury(): void {
    const { threshold, maxBonus, fullAt } = this.data.battle.rules.underdog;
    const sg = this.strength('gnomes');
    const sb = this.strength('goblins');
    for (const team of TEAMS) {
      const deficit = team === 'gnomes' ? sb - sg : sg - sb;
      this.fury[team] = maxBonus * Math.min(1, Math.max(0, (deficit - threshold) / (fullAt - threshold)));
    }
  }

  /** silent : dégâts continus (zone) sans événement 'hit', pour ne pas noyer le rendu sous les flashs. */
  private applyDamage(t: Unit, damage: number, source: Unit | null, dirX: number, dirY: number, knockback: number, silent = false): void {
    if (t.state === 'dead') return;
    const rules = this.data.battle.rules;
    t.hp -= damage;
    t.kx += (dirX * knockback) / t.mass;
    t.ky += (dirY * knockback) / t.mass;
    t.morale -= (rules.moraleLossOnHit * damage) / t.maxHp;
    // Les tirs alliés et sur soi ne comptent pas comme des exploits.
    if (source && source.team !== t.team) source.damageDealt += damage;
    if (!silent) this.events.push({ type: 'hit', unit: t.index, source: source?.index ?? -1, damage, knockback });
    if (t.hp <= 0) this.kill(t, source);
  }

  private kill(t: Unit, killer: Unit | null): void {
    const rules = this.data.battle.rules;
    t.hp = 0;
    t.state = 'dead';
    t.charging = false;
    t.deathTime = this.time;
    this.releaseTarget(t);
    if (killer && killer.team !== t.team) killer.kills++;
    this.events.push({ type: 'death', unit: t.index, killer: killer?.index ?? -1 });
    this.grid.query(t.x, t.y, rules.allyDeathRadius, (o) => {
      if (o.state === 'dead' || hypot(o.x - t.x, o.y - t.y) > rules.allyDeathRadius) return;
      // La mort d'un héros pèse plus lourd sur le moral.
      const weight = t.hero ? 2.5 : 1;
      if (o.team === t.team) o.morale -= rules.moraleLossOnAllyDeath * weight;
      else o.morale = Math.min(1, o.morale + 0.05 * weight);
    });
  }

  private updateProjectiles(): void {
    for (const p of this.projectiles) {
      if (p.done) continue;
      p.age += this.dt;
      const k = Math.min(1, p.age / p.flightTime);
      p.x = p.fromX + (p.toX - p.fromX) * k;
      p.y = p.fromY + (p.toY - p.fromY) * k;
      if (k < 1) continue;
      p.done = true;
      if (p.effects) {
        this.landEffectProjectile(p);
        continue;
      }
      let hit: Unit | undefined;
      let best = Infinity;
      this.grid.query(p.x, p.y, this.maxRadius + 2.5, (e) => {
        if (e.team === p.team || e.state === 'dead') return;
        const d = hypot(e.x - p.x, e.y - p.y);
        if (d <= e.radius + 2.5 && d < best) {
          best = d;
          hit = e;
        }
      });
      if (hit) {
        const dx = p.toX - p.fromX;
        const dy = p.toY - p.fromY;
        const l = hypot(dx, dy) || 1;
        const owner = this.units[p.owner];
        this.applyDamage(hit, p.damage, owner, dx / l, dy / l, p.attack?.knockback ?? 0);
      } else {
        this.events.push({ type: 'miss', x: p.x, y: p.y, source: p.owner });
      }
    }
    // Purge en place pour garder un tableau court.
    let w = 0;
    for (const p of this.projectiles) if (!p.done) this.projectiles[w++] = p;
    this.projectiles.length = w;
  }

  // ---------------------------------------------------------------- mouvement

  private move(u: Unit): void {
    const dt = this.dt;
    const rules = this.data.battle.rules;
    const decay = this.decayPerTick;
    if (u.state === 'dead') {
      // Les corps glissent encore un peu sous l'effet du dernier coup.
      u.x += u.kx * dt;
      u.y += u.ky * dt;
      u.kx *= decay;
      u.ky *= decay;
      this.clampToField(u);
      return;
    }

    let sx = 0;
    let sy = 0;
    this.grid.query(u.x, u.y, u.radius * 2 + 12, (o) => {
      if (o === u || o.state === 'dead') return;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const d = hypot(dx, dy) || 0.01;
      const minD = u.radius + o.radius + (o.team === u.team ? 2.5 : 0.5);
      if (d < minD + 3) {
        const push = ((minD + 3 - d) / (minD + 3)) * rules.separationStrength * (o.team === u.team ? 1 : 0.6);
        sx += (dx / d) * push;
        sy += (dy / d) * push;
      }
      // Recouvrement franc : on sépare les corps, le plus lourd bouge moins.
      const overlap = u.radius + o.radius - d;
      if (overlap > 0) {
        const share = o.mass / (u.mass + o.mass);
        u.x += (dx / d) * overlap * share * 0.5;
        u.y += (dy / d) * overlap * share * 0.5;
      }
    });

    this.wanderAngle[u.index] += this.rng.range(-1, 1) * 4 * dt;
    const wa = this.wanderAngle[u.index];
    const slow = u.slowUntil > this.time ? u.slowFactor : 1;
    if (slow === 1) u.slowFactor = 1;
    let vx = u.vx * slow + sx + cos(wa) * rules.wander;
    let vy = u.vy * slow + sy + sin(wa) * rules.wander;

    // Les murs repoussent doucement : personne ne reste coincé dans un coin.
    const f = this.field;
    const margin = 16;
    const wallPush = u.speed * 1.2;
    const near = (d: number) => Math.max(0, (margin - d) / margin) * wallPush;
    vx += near(u.x - f.x) - near(f.x + f.width - u.x);
    vy += near(u.y - f.y) - near(f.y + f.height - u.y);

    // Hors de la zone : on revient vers le centre.
    const z = this.zone;
    if (u.x < z.x || u.x > z.x + z.width || u.y < z.y || u.y > z.y + z.height) {
      const cx = z.x + z.width / 2 - u.x;
      const cy = z.y + z.height / 2 - u.y;
      const cl = hypot(cx, cy) || 1;
      vx += (cx / cl) * u.speed * 0.8;
      vy += (cy / cl) * u.speed * 0.8;
      const zoneDamage = this.data.battle.ending.zoneDamage * u.maxHp * dt;
      if (zoneDamage > 0) this.applyDamage(u, zoneDamage, null, 0, 0, 0, true);
      if (u.hp <= 0) return;
    }

    u.x += (vx + u.kx) * dt;
    u.y += (vy + u.ky) * dt;
    u.kx *= decay;
    u.ky *= decay;
    this.clampToField(u);
  }

  private clampToField(u: Unit): void {
    const f = this.field;
    u.x = Math.min(f.x + f.width - u.radius, Math.max(f.x + u.radius, u.x));
    u.y = Math.min(f.y + f.height - u.radius, Math.max(f.y + u.radius, u.y));
  }

  // ---------------------------------------------------------------- équipements et effets

  /** Attaque spéciale d'un équipement, avec son éventuel raté. Renvoie vrai si elle a été utilisée. */
  private trySpecial(u: Unit, target: Unit, gap: number): boolean {
    for (let i = 0; i < u.equipment.length; i++) {
      const eq = u.equipment[i];
      const sp = eq.special;
      if (!sp || u.specialCooldowns[i] > 0 || gap < sp.minRange || gap > sp.maxRange) continue;
      u.specialCooldowns[i] = sp.cooldown * this.rng.range(0.85, 1.15);
      const ctx: EffectContext = { source: u, team: u.team, x: target.x, y: target.y, target, fromX: u.x, fromY: u.y };
      let misfire = false;
      if (sp.misfire && this.rng.chance(sp.misfire.chance)) {
        misfire = true;
        // Le tir part de travers et n'épargne plus personne.
        ctx.team = null;
        if (sp.misfire.mode === 'self') {
          Object.assign(ctx, { x: u.x, y: u.y, target: u });
        } else if (sp.misfire.mode === 'ally') {
          const ally = this.nearest(u, (o) => o.team === u.team && o !== u);
          if (ally) Object.assign(ctx, { x: ally.x, y: ally.y, target: ally });
        } else {
          const a = this.rng.range(0, Math.PI * 2);
          const d = hypot(target.x - u.x, target.y - u.y);
          Object.assign(ctx, { x: u.x + cos(a) * d, y: u.y + sin(a) * d, target: undefined });
        }
      }
      this.events.push({ type: 'special', unit: u.index, equipment: eq.id, misfire });
      runEffects(this, sp.effects, ctx);
      return true;
    }
    return false;
  }

  private nearest(u: Unit, accept: (o: Unit) => boolean): Unit | undefined {
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const o of this.units) {
      if (o.state === 'dead' || !accept(o)) continue;
      const d = hypot(o.x - u.x, o.y - u.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** @internal EffectHost */
  random(): number {
    return this.rng.next();
  }

  /** @internal EffectHost */
  queryUnits(x: number, y: number, radius: number, visit: (u: Unit) => void): void {
    this.grid.query(x, y, radius, (u) => {
      if (u.state !== 'dead') visit(u);
    });
  }

  /** @internal EffectHost */
  damage(target: Unit, amount: number, source: Unit | null, dirX: number, dirY: number, knockback: number): void {
    this.applyDamage(target, amount, source, dirX, dirY, knockback);
  }

  /** @internal EffectHost */
  emit(event: BattleEvent): void {
    this.events.push(event);
  }

  /** @internal EffectHost */
  spawnEffectProjectile(effect: Extract<EffectDef, { type: 'projectile' }>, ctx: EffectContext): void {
    const angle = this.rng.range(0, Math.PI * 2);
    const offset = this.rng.next() * effect.spread;
    const toX = ctx.x + cos(angle) * offset;
    const toY = ctx.y + sin(angle) * offset;
    const dist = hypot(toX - ctx.fromX, toY - ctx.fromY);
    this.projectiles.push({
      id: this.nextProjectileId++,
      team: ctx.team,
      owner: ctx.source?.index ?? -1,
      damage: 0,
      effects: effect.effects,
      visual: effect.visual,
      arc: effect.arc,
      fromX: ctx.fromX,
      fromY: ctx.fromY,
      toX,
      toY,
      flightTime: Math.max(0.1, dist / effect.speed),
      age: 0,
      x: ctx.fromX,
      y: ctx.fromY,
      done: false,
    });
  }

  private landEffectProjectile(p: Projectile): void {
    const source = p.owner >= 0 ? this.units[p.owner] : null;
    let target: Unit | undefined;
    let best = Infinity;
    this.grid.query(p.x, p.y, this.maxRadius + 2.5, (e) => {
      if (e.state === 'dead' || (p.team !== null && e.team === p.team)) return;
      const d = hypot(e.x - p.x, e.y - p.y);
      if (d <= e.radius + 2.5 && d < best) {
        best = d;
        target = e;
      }
    });
    runEffects(this, p.effects!, { source, team: p.team, x: p.x, y: p.y, target, fromX: p.fromX, fromY: p.fromY });
  }

  // ---------------------------------------------------------------- incidents d'arène

  private updateIncidents(): void {
    const cfg = this.data.battle.events;
    if (cfg.perMinute <= 0 || this.data.events.length === 0) return;
    const interval = 60 / cfg.perMinute;
    if (this.nextIncidentAt < 0) this.nextIncidentAt = cfg.firstAt + this.rng.range(0, interval);

    if (this.time >= this.nextIncidentAt) {
      const eligible = this.data.events.filter((e) => e.from <= this.time);
      if (eligible.length > 0) {
        const weights = Object.fromEntries(eligible.map((e) => [e.id, e.weight]));
        const picked = this.rng.weighted(weights);
        const def = eligible.find((e) => e.id === picked)!;
        const target = this.incidentPoint(def);
        if (target) {
          const [x, y] = target;
          // Les projectiles d'incident tombent des gradins, du côté le plus proche.
          const f = this.field;
          const fromX = x + this.rng.range(-30, 30);
          const fromY = y < f.y + f.height / 2 ? f.y - 20 : f.y + f.height + 20;
          // L'ombre reste jusqu'à l'impact, vol du projectile compris.
          const projectile = def.effects.find((e) => e.type === 'projectile');
          const flight = projectile ? Math.max(0.1, hypot(x - fromX, y - fromY) / projectile.speed) : 0;
          this.pendingIncidents.push({ def, x, y, fromX, fromY, at: this.time + def.telegraph });
          this.events.push({ type: 'incident', event: def.id, label: def.label, visual: def.visual, x, y });
          if (def.telegraph + flight > 0) {
            this.events.push({ type: 'telegraph', event: def.id, visual: def.visual, x, y, radius: def.telegraphRadius, duration: def.telegraph + flight });
          }
        }
      }
      // Les catastrophes s'intensifient à mesure que l'arène se resserre.
      const { minScale } = this.data.battle.ending;
      const ramp = minScale < 1 ? 1 + ((cfg.endRamp - 1) * (1 - this.zoneScale)) / (1 - minScale) : 1;
      this.nextIncidentAt = this.time + (interval / ramp) * this.rng.range(0.6, 1.4);
    }

    for (let i = this.pendingIncidents.length - 1; i >= 0; i--) {
      const inc = this.pendingIncidents[i];
      if (this.time < inc.at) continue;
      this.pendingIncidents.splice(i, 1);
      runEffects(this, inc.def.effects, { source: null, team: null, x: inc.x, y: inc.y, fromX: inc.fromX, fromY: inc.fromY });
    }
  }

  private incidentPoint(def: ArenaEventDef): [number, number] | undefined {
    const alive = this.alive();
    if (alive.length === 0) return undefined;
    const z = this.zone;
    const pick = () => alive[this.rng.int(0, alive.length - 1)];
    switch (def.target) {
      case 'random_unit': {
        const u = pick();
        return [u.x, u.y];
      }
      case 'hero': {
        const heroes = alive.filter((u) => u.hero);
        const u = heroes.length ? heroes[this.rng.int(0, heroes.length - 1)] : pick();
        return [u.x, u.y];
      }
      case 'densest': {
        // Quelques candidats tirés au sort, on garde celui qui a le plus de voisins.
        let best = pick();
        let bestCount = -1;
        for (let i = 0; i < 6; i++) {
          const c = pick();
          let count = 0;
          this.grid.query(c.x, c.y, 20, (o) => {
            if (o.state !== 'dead' && hypot(o.x - c.x, o.y - c.y) <= 20) count++;
          });
          if (count > bestCount) {
            bestCount = count;
            best = c;
          }
        }
        return [best.x, best.y];
      }
      default:
        return [z.x + this.rng.range(0.1, 0.9) * z.width, z.y + this.rng.range(0.1, 0.9) * z.height];
    }
  }

  // ---------------------------------------------------------------- fin de combat

  private updateZone(): void {
    const { shrinkStart, shrinkEnd, minScale } = this.data.battle.ending;
    const k = Math.min(1, Math.max(0, (this.time - shrinkStart) / (shrinkEnd - shrinkStart)));
    this.zoneScale = 1 - (1 - minScale) * k;
    const f = this.field;
    const w = f.width * this.zoneScale;
    const h = f.height * this.zoneScale;
    this.zone = { x: f.x + (f.width - w) / 2, y: f.y + (f.height - h) / 2, width: w, height: h };
    if (k > 0 && !this.zoneAnnounced) {
      this.zoneAnnounced = true;
      this.events.push({ type: 'zone', scale: this.zoneScale });
    }
  }

  private sampleStrength(): void {
    this.history.push({ t: this.time, gnomes: this.strength('gnomes'), goblins: this.strength('goblins') });
  }

  private checkEnd(): void {
    const gnomes = this.alive('gnomes').length;
    const goblins = this.alive('goblins').length;
    let winner: TeamId | 'draw' | null = null;
    let reason: BattleResult['reason'] = 'elimination';
    if (gnomes === 0 || goblins === 0) {
      winner = gnomes > 0 ? 'gnomes' : goblins > 0 ? 'goblins' : 'draw';
    } else if (this.time >= this.data.battle.ending.hardCap) {
      reason = 'timeout';
      const sg = this.strength('gnomes');
      const sb = this.strength('goblins');
      winner = sg === sb ? 'draw' : sg > sb ? 'gnomes' : 'goblins';
    }
    if (!winner) return;
    this.sampleStrength();
    this.result = { winner, reason, duration: this.time, survivors: { gnomes, goblins } };
    this.events.push({ type: 'end', winner, reason });
  }
}

export { other as opposingTeam };
