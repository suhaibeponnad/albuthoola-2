/**
 * Database module for Artfest Point Manager
 * Supports dual-engine persistence:
 * 1. Supabase Cloud Database (Real-time sync across devices)
 * 2. Offline LocalStorage Fallback (Works without internet / unconfigured)
 */

const STORAGE_KEY = 'artfest_points_db';
const SUPABASE_CONFIG_KEY = 'artfest_supabase_config';

const DEFAULT_DB = {
  houses: [
    { id: 'house-1', name: 'Phoenix Fire', color: '#ef4444', secondaryColor: '#991b1b', emblem: '🔥' },
    { id: 'house-2', name: 'Pegasus Frost', color: '#3b82f6', secondaryColor: '#1e3a8a', emblem: '❄️' },
    { id: 'house-3', name: 'Emerald Titans', color: '#10b981', secondaryColor: '#064e3b', emblem: '🍃' },
    { id: 'house-4', name: 'Golden Dragons', color: '#eab308', secondaryColor: '#713f12', emblem: '⚡' }
  ],
  events: [],
  results: {},
  settings: {
    adminPin: "1234",
    rules: {
      solo: { '1st': 10, '2nd': 6, '3rd': 4, 'gradeA': 5, 'gradeB': 3 },
      group: { '1st': 20, '2nd': 12, '3rd': 8, 'gradeA': 10, 'gradeB': 6 }
    }
  }
};

class ArtfestDB {
  constructor() {
    this.data = this.load();
    this.supabaseClient = null;
    this.isCloudConnected = false;
    this.initSupabase();
  }

  // --- SUPABASE ENGINE INITIALIZATION & CLOUD CONTROLLER ---
  initSupabase() {
    try {
      const storedConfig = localStorage.getItem(SUPABASE_CONFIG_KEY);
      if (storedConfig && window.supabase) {
        const { url, key } = JSON.parse(storedConfig);
        if (url && key) {
          this.supabaseClient = window.supabase.createClient(url.trim(), key.trim());
          this.isCloudConnected = true;
          this.subscribeRealtime();
          this.fetchCloudData();
        }
      }
    } catch (err) {
      console.warn('Supabase initialization failed:', err);
      this.isCloudConnected = false;
    }
  }

  getSupabaseConfig() {
    try {
      const stored = localStorage.getItem(SUPABASE_CONFIG_KEY);
      return stored ? JSON.parse(stored) : { url: '', key: '' };
    } catch (e) {
      return { url: '', key: '' };
    }
  }

  saveSupabaseConfig(url, key) {
    if (!url || !key) return false;
    try {
      localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url: url.trim(), key: key.trim() }));
      this.initSupabase();
      return true;
    } catch (e) {
      return false;
    }
  }

  disconnectSupabase() {
    localStorage.removeItem(SUPABASE_CONFIG_KEY);
    this.supabaseClient = null;
    this.isCloudConnected = false;
  }

  async fetchCloudData() {
    if (!this.isCloudConnected || !this.supabaseClient) return;

    try {
      // 1. Fetch houses
      const { data: housesData } = await this.supabaseClient.from('houses').select('*');
      if (housesData && housesData.length > 0) {
        this.data.houses = housesData.map(h => ({
          id: h.id,
          name: h.name,
          color: h.color,
          secondaryColor: h.secondary_color,
          emblem: h.emblem
        }));
      }

      // 2. Fetch events
      const { data: eventsData } = await this.supabaseClient.from('events').select('*');
      if (eventsData) {
        this.data.events = eventsData.map(e => ({
          id: e.id,
          name: e.name,
          type: e.type,
          category: e.category,
          completed: e.completed,
          pointsConfig: e.points_config
        }));
      }

      // 3. Fetch results
      const { data: resultsData } = await this.supabaseClient.from('results').select('*');
      if (resultsData) {
        const resultsMap = {};
        resultsData.forEach(r => {
          if (!resultsMap[r.event_id]) resultsMap[r.event_id] = [];
          resultsMap[r.event_id].push({
            position: r.position,
            grade: r.grade,
            houseId: r.house_id,
            participant: r.participant,
            points: r.points
          });
        });
        this.data.results = resultsMap;
      }

      // 4. Fetch settings
      const { data: settingsData } = await this.supabaseClient.from('settings').select('*').eq('id', 'global').single();
      if (settingsData) {
        if (settingsData.admin_pin) this.data.settings.adminPin = settingsData.admin_pin;
        if (settingsData.rules) this.data.settings.rules = settingsData.rules;
      }

      this.save();
      if (window.onCloudDataSynced) window.onCloudDataSynced();
    } catch (err) {
      console.error('Error fetching data from Supabase:', err);
    }
  }

  subscribeRealtime() {
    if (!this.isCloudConnected || !this.supabaseClient) return;
    try {
      this.supabaseClient
        .channel('public:artfest')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => {
          this.fetchCloudData();
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription error:', e);
    }
  }

  async syncLocalToCloud() {
    if (!this.isCloudConnected || !this.supabaseClient) return false;

    try {
      // Upsert houses
      for (const house of this.data.houses) {
        await this.supabaseClient.from('houses').upsert({
          id: house.id,
          name: house.name,
          color: house.color,
          secondary_color: house.secondaryColor,
          emblem: house.emblem
        });
      }

      // Upsert events
      for (const event of this.data.events) {
        await this.supabaseClient.from('events').upsert({
          id: event.id,
          name: event.name,
          type: event.type,
          category: event.category,
          completed: event.completed,
          points_config: event.pointsConfig
        });
      }

      // Upsert results
      for (const eventId of Object.keys(this.data.results)) {
        await this.supabaseClient.from('results').delete().eq('event_id', eventId);
        const winners = this.data.results[eventId];
        for (const w of winners) {
          await this.supabaseClient.from('results').insert({
            event_id: eventId,
            house_id: w.houseId,
            participant: w.participant,
            position: w.position,
            grade: w.grade,
            points: w.points
          });
        }
      }

      // Upsert settings
      await this.supabaseClient.from('settings').upsert({
        id: 'global',
        admin_pin: this.data.settings.adminPin,
        rules: this.data.settings.rules
      });

      await this.fetchCloudData();
      return true;
    } catch (err) {
      console.error('Error syncing local data to Supabase:', err);
      return false;
    }
  }

  // --- LOCAL PERSISTENCE ---
  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const merged = JSON.parse(JSON.stringify(DEFAULT_DB));
        
        if (parsed.houses && Array.isArray(parsed.houses)) merged.houses = parsed.houses;
        if (parsed.events && Array.isArray(parsed.events)) {
          merged.events = parsed.events.filter(e => !e.id.startsWith('event-'));
        }
        if (parsed.results && typeof parsed.results === 'object') {
          const cleanResults = {};
          Object.keys(parsed.results).forEach(k => {
            if (!k.startsWith('event-')) {
              cleanResults[k] = parsed.results[k];
            }
          });
          merged.results = cleanResults;
        }
        
        if (parsed.settings && typeof parsed.settings === 'object') {
          if (parsed.settings.adminPin) {
            merged.settings.adminPin = String(parsed.settings.adminPin);
          }
          if (parsed.settings.rules && typeof parsed.settings.rules === 'object') {
            if (parsed.settings.rules.solo) {
              merged.settings.rules.solo = { ...merged.settings.rules.solo, ...parsed.settings.rules.solo };
            }
            if (parsed.settings.rules.group) {
              merged.settings.rules.group = { ...merged.settings.rules.group, ...parsed.settings.rules.group };
            }
          }
        }

        merged.events.forEach(event => {
          if (!event.pointsConfig) {
            event.pointsConfig = JSON.parse(JSON.stringify(merged.settings.rules[event.type]));
          }
        });

        return merged;
      }
    } catch (e) {
      console.error('Failed to load artfest data:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('Failed to save artfest data:', e);
    }
  }

  // --- HOUSES ---
  getHouses() {
    return this.data.houses;
  }

  async addHouse(name, color, emblem) {
    const id = 'house-' + Date.now();
    const secondaryColor = this.adjustColorBrightness(color, -30);
    const newHouse = { id, name, color, secondaryColor, emblem };
    this.data.houses.push(newHouse);
    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('houses').insert({
        id,
        name,
        color,
        secondary_color: secondaryColor,
        emblem
      });
    }

    return newHouse;
  }

  async updateHouse(id, name, color, emblem) {
    const house = this.data.houses.find(h => h.id === id);
    if (house) {
      house.name = name;
      house.color = color;
      house.secondaryColor = this.adjustColorBrightness(color, -30);
      house.emblem = emblem;
      this.save();

      if (this.isCloudConnected && this.supabaseClient) {
        await this.supabaseClient.from('houses').update({
          name,
          color,
          secondary_color: house.secondaryColor,
          emblem
        }).eq('id', id);
      }
    }
    return house;
  }

  async deleteHouse(id) {
    this.data.houses = this.data.houses.filter(h => h.id !== id);
    
    Object.keys(this.data.results).forEach(eventId => {
      this.data.results[eventId] = this.data.results[eventId].filter(winner => winner.houseId !== id);
    });

    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('houses').delete().eq('id', id);
    }
  }

  adjustColorBrightness(hex, percent) {
    let num = parseInt(hex.replace('#', ''), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        B = (num >> 8 & 0x00FF) + amt,
        G = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (B<255?B<1?0:B:255)*0x100 + (G<255?G<1?0:G:255)).toString(16).slice(1);
  }

  // --- EVENTS ---
  getEvents() {
    return this.data.events;
  }

  async addEvent(name, type, category, customPointsConfig = null) {
    const id = 'event-' + Date.now();
    const defaultPoints = this.data.settings.rules[type];
    const pointsConfig = customPointsConfig ? { ...defaultPoints, ...customPointsConfig } : JSON.parse(JSON.stringify(defaultPoints));

    const newEvent = { id, name, type, category, completed: false, pointsConfig };
    this.data.events.push(newEvent);
    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('events').insert({
        id,
        name,
        type,
        category,
        completed: false,
        points_config: pointsConfig
      });
    }

    return newEvent;
  }

  async updateEvent(id, name, type, category, customPointsConfig = null) {
    const event = this.data.events.find(e => e.id === id);
    if (event) {
      event.name = name;
      event.type = type;
      event.category = category;
      
      const defaultPoints = this.data.settings.rules[type];
      if (customPointsConfig) {
        event.pointsConfig = { ...defaultPoints, ...customPointsConfig };
      } else if (!event.pointsConfig) {
        event.pointsConfig = JSON.parse(JSON.stringify(defaultPoints));
      }

      if (event.completed && this.data.results[id]) {
        this.recalculateEventPoints(id);
      }

      this.save();

      if (this.isCloudConnected && this.supabaseClient) {
        await this.supabaseClient.from('events').update({
          name,
          type,
          category,
          points_config: event.pointsConfig
        }).eq('id', id);
      }
    }
    return event;
  }

  async deleteEvent(id) {
    this.data.events = this.data.events.filter(e => e.id !== id);
    delete this.data.results[id];
    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('events').delete().eq('id', id);
    }
  }

  // --- RESULTS & POINTS ENGINE ---
  getResults() {
    return this.data.results;
  }

  async saveResult(eventId, winners) {
    const event = this.data.events.find(e => e.id === eventId);
    if (!event) return;

    const ptsConfig = event.pointsConfig || this.data.settings.rules[event.type];

    const processedWinners = winners.map(w => {
      let posPts = 0;
      if (w.position === 1) posPts = ptsConfig['1st'] || 0;
      else if (w.position === 2) posPts = ptsConfig['2nd'] || 0;
      else if (w.position === 3) posPts = ptsConfig['3rd'] || 0;

      let gradePts = 0;
      if (w.grade === 'A') gradePts = ptsConfig['gradeA'] || 0;
      else if (w.grade === 'B') gradePts = ptsConfig['gradeB'] || 0;

      return {
        position: w.position || null,
        grade: w.grade || null,
        houseId: w.houseId,
        participant: w.participant,
        points: posPts + gradePts
      };
    });

    this.data.results[eventId] = processedWinners;
    event.completed = true;
    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('events').update({ completed: true }).eq('id', eventId);
      await this.supabaseClient.from('results').delete().eq('event_id', eventId);
      
      for (const w of processedWinners) {
        await this.supabaseClient.from('results').insert({
          event_id: eventId,
          house_id: w.houseId,
          participant: w.participant,
          position: w.position,
          grade: w.grade,
          points: w.points
        });
      }
    }
  }

  recalculateEventPoints(eventId) {
    const event = this.data.events.find(e => e.id === eventId);
    if (!event || !this.data.results[eventId]) return;

    const ptsConfig = event.pointsConfig || this.data.settings.rules[event.type];

    this.data.results[eventId] = this.data.results[eventId].map(w => {
      let posPts = 0;
      if (w.position === 1) posPts = ptsConfig['1st'] || 0;
      else if (w.position === 2) posPts = ptsConfig['2nd'] || 0;
      else if (w.position === 3) posPts = ptsConfig['3rd'] || 0;

      let gradePts = 0;
      if (w.grade === 'A') gradePts = ptsConfig['gradeA'] || 0;
      else if (w.grade === 'B') gradePts = ptsConfig['gradeB'] || 0;

      return {
        ...w,
        points: posPts + gradePts
      };
    });
  }

  async deleteResult(eventId) {
    delete this.data.results[eventId];
    const event = this.data.events.find(e => e.id === eventId);
    if (event) {
      event.completed = false;
    }
    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('events').update({ completed: false }).eq('id', eventId);
      await this.supabaseClient.from('results').delete().eq('event_id', eventId);
    }
  }

  // --- SETTINGS & SECURITY ---
  getSettings() {
    return this.data.settings;
  }

  async updateRules(soloRules, groupRules) {
    const oldSolo = JSON.parse(JSON.stringify(this.data.settings.rules.solo));
    const oldGroup = JSON.parse(JSON.stringify(this.data.settings.rules.group));

    this.data.settings.rules.solo = soloRules;
    this.data.settings.rules.group = groupRules;
    
    this.data.events.forEach(event => {
      const oldDefaults = event.type === 'solo' ? oldSolo : oldGroup;
      const newDefaults = event.type === 'solo' ? soloRules : groupRules;

      let matches = true;
      if (event.pointsConfig) {
        Object.keys(newDefaults).forEach(key => {
          if (event.pointsConfig[key] !== oldDefaults[key]) {
            matches = false;
          }
        });
      } else {
        matches = true;
      }

      if (matches) {
        event.pointsConfig = JSON.parse(JSON.stringify(newDefaults));
      }

      if (event.completed && this.data.results[event.id]) {
        this.recalculateEventPoints(event.id);
      }
    });
    this.save();

    if (this.isCloudConnected && this.supabaseClient) {
      await this.supabaseClient.from('settings').upsert({
        id: 'global',
        rules: this.data.settings.rules
      });
    }
  }

  verifyAdminPin(pin) {
    const currentPin = this.data.settings.adminPin || '1234';
    return String(pin).trim() === String(currentPin).trim();
  }

  async updateAdminPin(newPin) {
    if (newPin && String(newPin).trim().length > 0) {
      this.data.settings.adminPin = String(newPin).trim();
      this.save();

      if (this.isCloudConnected && this.supabaseClient) {
        await this.supabaseClient.from('settings').upsert({
          id: 'global',
          admin_pin: this.data.settings.adminPin
        });
      }
      return true;
    }
    return false;
  }

  // --- CALCULATE STANDINGS & STATS ---
  calculateStandings() {
    const standings = {};
    this.data.houses.forEach(house => {
      standings[house.id] = {
        ...house,
        totalPoints: 0,
        positions: { 1: 0, 2: 0, 3: 0 },
        grades: { 'A': 0, 'B': 0 },
        breakdown: []
      };
    });

    Object.keys(this.data.results).forEach(eventId => {
      const event = this.data.events.find(e => e.id === eventId);
      if (!event) return;

      const winners = this.data.results[eventId];
      winners.forEach(w => {
        if (standings[w.houseId]) {
          standings[w.houseId].totalPoints += w.points;
          if (w.position >= 1 && w.position <= 3) {
            standings[w.houseId].positions[w.position] += 1;
          }
          if (w.grade === 'A' || w.grade === 'B') {
            standings[w.houseId].grades[w.grade] += 1;
          }
          standings[w.houseId].breakdown.push({
            eventId: event.id,
            eventName: event.name,
            eventType: event.type,
            participant: w.participant,
            position: w.position,
            grade: w.grade,
            points: w.points
          });
        }
      });
    });

    return Object.values(standings).sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) {
        return b.totalPoints - a.totalPoints;
      }
      if (b.positions[1] !== a.positions[1]) {
        return b.positions[1] - a.positions[1];
      }
      return a.name.localeCompare(b.name);
    });
  }

  calculateSoloStudentLeaderboard() {
    const studentScores = {};
    
    this.data.events.forEach(event => {
      if (event.type === 'solo' && event.completed && this.data.results[event.id]) {
        const winners = this.data.results[event.id];
        winners.forEach(w => {
          if (w.participant && w.participant !== 'Anonymous') {
            const key = w.participant + '||' + w.houseId;
            studentScores[key] = (studentScores[key] || 0) + w.points;
          }
        });
      }
    });

    return Object.entries(studentScores)
      .map(([key, points]) => {
        const [name, houseId] = key.split('||');
        const house = this.data.houses.find(h => h.id === houseId);
        return {
          name,
          houseId,
          houseName: house ? house.name : 'Unknown House',
          houseEmblem: house ? house.emblem : '❓',
          houseColor: house ? house.color : '#6366f1',
          points
        };
      })
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);
  }

  getStatistics() {
    const houses = this.data.houses;
    const events = this.data.events;
    const results = this.data.results;

    const totalEvents = events.length;
    const completedEvents = events.filter(e => e.completed).length;
    const completionRate = totalEvents > 0 ? Math.round((completedEvents / totalEvents) * 100) : 0;

    const studentContributions = {};
    Object.keys(results).forEach(eventId => {
      results[eventId].forEach(w => {
        if (w.participant) {
          studentContributions[w.participant] = (studentContributions[w.participant] || 0) + w.points;
        }
      });
    });

    let topStudent = 'None';
    let topPoints = 0;
    Object.entries(studentContributions).forEach(([student, pts]) => {
      if (pts > topPoints) {
        topPoints = pts;
        topStudent = `${student} (${pts} pts)`;
      }
    });

    const recentActivity = [];
    const completedList = events.filter(e => e.completed);
    completedList.slice(-5).reverse().forEach(event => {
      const eventWinners = results[event.id] || [];
      const firstPlace = eventWinners.find(w => w.position === 1);
      if (firstPlace) {
        const house = houses.find(h => h.id === firstPlace.houseId);
        recentActivity.push({
          eventName: event.name,
          winner: firstPlace.participant,
          houseName: house ? house.name : 'Unknown',
          emblem: house ? house.emblem : '🏆'
        });
      }
    });

    return {
      totalEvents,
      completedEvents,
      completionRate,
      topStudent,
      recentActivity
    };
  }

  getHouseEmblemAndName(houseId) {
    const house = this.data.houses.find(h => h.id === houseId);
    return house ? `${house.emblem} ${house.name}` : 'Unknown';
  }

  // --- UTILS & DATA CONVERSION ---
  resetDatabase() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_DB));
    this.save();
  }

  exportData() {
    return JSON.stringify(this.data, null, 2);
  }

  importData(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.houses && parsed.events && parsed.results) {
        this.data = parsed;
        this.save();
        if (this.isCloudConnected) {
          this.syncLocalToCloud();
        }
        return true;
      }
    } catch (e) {
      console.error('Failed to import JSON data:', e);
    }
    return false;
  }
}

// Global DB Singleton
window.ArtfestDB = new ArtfestDB();
