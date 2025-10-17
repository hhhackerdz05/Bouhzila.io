const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

// =================================================================
// 1. إعدادات الخادم والثابتات
// =================================================================

// المنفذ الذي سيستمع إليه الخادم (Render يحدد هذا تلقائيًا)
const PORT = process.env.PORT || 8080;

// نطاق العميل (Render URL) الذي يتصل بالخادم.
// هذا ضروري لإعداد CORS بشكل صحيح وضمان عمل الاتصال عبر WSS.
const USER_SERVER_DOMAIN = 'bouhzila-io-1.onrender.com'; 

// حجم عالم اللعبة
const WORLD_SIZE = 5000;
const INITIAL_FOOD_COUNT = 100;
const FOOD_RADIUS = 5;
const PLAYER_START_MASS = 1000;
const PLAYER_START_RADIUS = 30;
const GAME_TICK_RATE = 1000 / 60; // 60 تحديث في الثانية

// هياكل بيانات اللعبة
const players = {};
let food = [];
let nextPlayerId = 1;

// =================================================================
// 2. منطق اللعبة الأساسي (Core Game Logic)
// =================================================================

/**
 * يولد نقاط طعام عشوائية
 */
function generateFood() {
    for (let i = food.length; i < INITIAL_FOOD_COUNT; i++) {
        food.push({
            id: Date.now() + i,
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            r: FOOD_RADIUS,
            color: getRandomColor()
        });
    }
}

/**
 * يحسب نصف قطر اللاعب بناءً على كتلته
 */
function calculateRadius(mass) {
    return Math.sqrt(mass / Math.PI);
}

/**
 * تحديث حالة اللعبة (60 مرة في الثانية)
 */
function updateGame() {
    // 1. معالجة حركة اللاعبين
    for (const id in players) {
        const player = players[id];
        
        if (player.input.x !== 0 || player.input.y !== 0) {
            // سرعة اللاعب تتناسب عكسياً مع كتلته
            const speed = 5 / Math.sqrt(player.mass / PLAYER_START_MASS);
            player.x += player.input.x * speed;
            player.y += player.input.y * speed;
            
            // قصر حركة اللاعب ضمن حدود العالم
            player.x = Math.max(player.r, Math.min(WORLD_SIZE - player.r, player.x));
            player.y = Math.max(player.r, Math.min(WORLD_SIZE - player.r, player.y));
        }

        // 2. معالجة استهلاك الطعام
        food = food.filter(f => {
            const dx = player.x - f.x;
            const dy = player.y - f.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < player.r) {
                player.mass += 10;
                player.score += 10;
                player.r = calculateRadius(player.mass);
                return false; 
            }
            return true;
        });

        // 3. معالجة اصطدام اللاعبين (الأكل)
        for (const otherId in players) {
            if (id === otherId) continue;

            const otherPlayer = players[otherId];
            
            const dx = player.x - otherPlayer.x;
            const dy = player.y - otherPlayer.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // شرط الأكل: يجب أن يكون اللاعب أكبر بـ 25% على الأقل
            if (player.mass > otherPlayer.mass * 1.25 && distance < player.r) {
                console.log(`Player ${player.id} ate Player ${otherPlayer.id}`);
                player.mass += otherPlayer.mass;
                player.score += otherPlayer.score;
                player.r = calculateRadius(player.mass);
                
                // إعادة تعيين اللاعب المأكول أو إزالته
                resetPlayer(otherId);
            }
        }
    }
    
    generateFood(); // تجديد الطعام
    broadcastState(); // إرسال التحديثات
}

/**
 * إعادة تعيين لاعب إلى موقع عشوائي بكتلة البداية
 */
function resetPlayer(id) {
    if (players[id]) {
        players[id].x = Math.random() * WORLD_SIZE;
        players[id].y = Math.random() * WORLD_SIZE;
        players[id].mass = PLAYER_START_MASS;
        players[id].score = 0;
        players[id].r = calculateRadius(PLAYER_START_MASS);
    }
}


// =================================================================
// 3. خادم HTTP (Express) لخدمة index.html
// =================================================================

const app = express();
const server = http.createServer(app);

// خدمة الملفات الثابتة من مجلد 'public' (لـ index.html وملفاته)
app.use(express.static(path.join(__dirname, 'public')));

// تشغيل خادم HTTP
server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    generateFood(); 
    setInterval(updateGame, GAME_TICK_RATE); 
});


// =================================================================
// 4. خادم WebSocket (ws)
// =================================================================

const wss = new WebSocketServer({ server });

// إعداد CORS للاتصال الآمن من نطاق Render
wss.on('headers', (headers, req) => {
    const origin = req.headers.origin;
    // التحقق من أن الاتصال قادم من النطاق الصحيح
    if (origin && origin.includes(USER_SERVER_DOMAIN)) {
        headers.push('Access-Control-Allow-Origin: *'); 
    }
});


wss.on('connection', (ws) => {
    // 1. تسجيل لاعب جديد
    const playerId = (nextPlayerId++).toString();
    const playerName = 'Player ' + playerId;
    
    players[playerId] = {
        id: playerId,
        name: playerName,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        mass: PLAYER_START_MASS,
        score: 0,
        r: PLAYER_START_RADIUS,
        color: getRandomColor(),
        input: { x: 0, y: 0 },
        ws: ws 
    };
    
    console.log(`Player ${playerId} (${playerName}) connected.`);

    // 2. إرسال بيانات التهيئة للاعب الجديد
    ws.send(JSON.stringify({
        type: 'INIT',
        id: playerId,
        worldSize: WORLD_SIZE,
        initialFood: food
    }));

    // 3. معالجة رسائل العميل (الحركة)
    ws.on('message', (message) => {
        const data = JSON.parse(message.toString());

        if (data.type === 'MOVE' && players[playerId]) {
            players[playerId].input.x = data.direction.x;
            players[playerId].input.y = data.direction.y;
        }
    });

    // 4. معالجة فصل الاتصال
    ws.on('close', () => {
        console.log(`Player ${playerId} (${playerName}) disconnected.`);
        delete players[playerId];
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
    });
});

/**
 * وظيفة بث حالة اللعبة لجميع اللاعبين
 */
function broadcastState() {
    const playersData = Object.values(players).map(p => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        r: p.r,
        score: p.score,
        mass: p.mass,
        color: p.color
    }));

    const gameState = JSON.stringify({
        type: 'UPDATE',
        players: playersData,
        food: food
    });

    Object.values(players).forEach(player => {
        if (player.ws.readyState === player.ws.OPEN) {
            player.ws.send(gameState);
        }
    });
}

/**
 * وظيفة مساعدة لتوليد لون عشوائي
 */
function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}