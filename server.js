// إعدادات الخادم والتبعيات
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// اسم النطاق الخاص بك على Render (مهم جداً للاتصال الآمن)
const USER_SERVER_DOMAIN = 'bouhzila-io-1.onrender.com';
const PORT = process.env.PORT || 8080;

// إعداد خادم Express
const app = express();
const server = http.createServer(app);

// خدمة الملفات الثابتة من مجلد 'public'
app.use(express.static(path.join(__dirname, 'public')));

// إعداد خادم WebSocket (مرتبط بخادم HTTP)
const wss = new WebSocket.Server({ server });

// ------------------------------------------------------------------
// منطق اللعبة
// ------------------------------------------------------------------

// إعدادات اللعبة الأساسية
const MAP_WIDTH = 4000;
const MAP_HEIGHT = 4000;
const PLAYER_START_SIZE = 10;
const BOT_COUNT = 15;
const FOOD_COUNT = 300;
const GAME_TICK = 1000 / 60; // 60 إطار في الثانية

// هياكل بيانات لحالة اللعبة
let players = {};
let food = [];
let bots = [];
let nextPlayerId = 1;

// ----------------------
// دوال المساعدة
// ----------------------

function createRandomFood() {
    return {
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        size: 1,
        color: getRandomColor()
    };
}

function getRandomColor() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function createPlayer(isBot = false, id = null) {
    const playerId = id || (isBot ? `bot_${nextPlayerId++}` : nextPlayerId++);
    const newPlayer = {
        id: playerId,
        name: isBot ? `Bot ${playerId.split('_')[1]}` : `Player ${playerId}`,
        cells: [{
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            size: PLAYER_START_SIZE,
            velX: 0,
            velY: 0,
            color: getRandomColor(),
            mass: PLAYER_START_SIZE * PLAYER_START_SIZE,
            isBot: isBot
        }],
        targetX: 0,
        targetY: 0,
        score: PLAYER_START_SIZE,
        lastHeartbeat: Date.now()
    };
    players[playerId] = newPlayer;
    if (isBot) {
        bots.push(newPlayer.id);
    }
    return newPlayer;
}

// تهيئة الطعام
function initializeFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
        food.push(createRandomFood());
    }
}

// ----------------------
// منطق الحركة
// ----------------------

function updateMovement(deltaTime) {
    Object.values(players).forEach(player => {
        if (!player.cells || player.cells.length === 0) return; // تأكد من وجود خلايا

        player.cells.forEach(cell => {
            // حساب السرعة بناءً على الكتلة (الخلايا الأكبر أبطأ)
            const speed = 100 / Math.log10(cell.mass + 10);

            // حركة اللاعبين البشريين (باستخدام targetX/Y)
            if (!player.cells[0].isBot) {
                const angle = Math.atan2(player.targetY - cell.y, player.targetX - cell.x);
                cell.velX = Math.cos(angle) * speed;
                cell.velY = Math.sin(angle) * speed;

                // التوقف إذا كانت المسافة قصيرة لتجنب الارتعاش
                const distance = Math.sqrt((player.targetX - cell.x)**2 + (player.targetY - cell.y)**2);
                if (distance < cell.size / 2) {
                    cell.velX = 0;
                    cell.velY = 0;
                }
            }
            // حركة البوتات (يتم تحديد targetX/Y بواسطة AI)
            // إذا كان بوتًا، فسيتم تعيين targetX/Y بواسطة وظيفة updateBotAI

            // تطبيق الحركة والحدود
            cell.x += cell.velX * deltaTime;
            cell.y += cell.velY * deltaTime;

            // تطبيق حدود الخريطة
            cell.x = Math.max(cell.size, Math.min(MAP_WIDTH - cell.size, cell.x));
            cell.y = Math.max(cell.size, Math.min(MAP_HEIGHT - cell.size, cell.y));
        });
    });
}

// ----------------------
// منطق الروبوتات (AI)
// ----------------------

function updateBotAI() {
    bots.forEach(botId => {
        const bot = players[botId];
        if (!bot || bot.cells.length === 0) return;

        const mainCell = bot.cells[0];

        // 1. البحث عن أقرب طعام
        let closestTarget = null;
        let minDistance = Infinity;

        // دمج الطعام واللاعبين الأصغر كأهداف
        const targets = [...food, ...Object.values(players).flatMap(p => 
            p.cells.filter(c => c.size < mainCell.size * 0.95 && c.id !== mainCell.id)
        )];

        targets.forEach(target => {
            const distance = Math.sqrt((mainCell.x - target.x)**2 + (mainCell.y - target.y)**2);
            if (distance < minDistance) {
                minDistance = distance;
                closestTarget = target;
            }
        });

        if (closestTarget) {
            bot.targetX = closestTarget.x;
            bot.targetY = closestTarget.y;
        } else {
            // حركة عشوائية إذا لم يجد هدفًا
            bot.targetX = mainCell.x + (Math.random() - 0.5) * 500;
            bot.targetY = mainCell.y + (Math.random() - 0.5) * 500;
        }

        // تطبيق الهدف على جميع خلايا البوت (مبسط)
        bot.cells.forEach(cell => {
            cell.targetX = bot.targetX;
            cell.targetY = bot.targetY;
        });
    });
}

// ----------------------
// منطق الاصطدام (الأكل)
// ----------------------

function checkCollisions() {
    // 1. اصطدام اللاعب بالطعام
    food = food.filter(f => {
        let eaten = false;
        Object.values(players).forEach(player => {
            player.cells.forEach(cell => {
                const distance = Math.sqrt((cell.x - f.x)**2 + (cell.y - f.y)**2);
                if (distance < cell.size) { // إذا تداخلت الخلية مع الطعام
                    cell.mass += f.size * 0.5; // يزداد الوزن
                    cell.size = Math.sqrt(cell.mass / Math.PI); // يتم تحديث الحجم
                    player.score = cell.mass;
                    eaten = true;
                }
            });
        });
        return !eaten; // إزالة الطعام المأكول
    });

    // إعادة توليد الطعام
    while (food.length < FOOD_COUNT) {
        food.push(createRandomFood());
    }

    // 2. اصطدام اللاعب باللاعب
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
        const playerA = players[playerIds[i]];

        for (let j = i + 1; j < playerIds.length; j++) {
            const playerB = players[playerIds[j]];

            if (!playerA || !playerB) continue; // تحقق إضافي

            // تحقق من اصطدام كل خلية من A بكل خلية من B
            playerA.cells.forEach(cellA => {
                // التصحيح: يجب التأكد من وجود playerB.cells
                if (!playerB.cells) return;

                playerB.cells.forEach(cellB => {
                    const distance = Math.sqrt((cellA.x - cellB.x)**2 + (cellA.y - cellB.y)**2);

                    // شرط الأكل: يجب أن تكون الخلية الآكلة أكبر بكثير
                    const EAT_THRESHOLD = 1.1; // يجب أن تكون أكبر بنسبة 10%
                    const mergeThreshold = 1.0; // إذا كانت الأحجام متقاربة، يمكنها الاندماج

                    if (distance < cellA.size && distance < cellB.size) {
                        // حالة الأكل
                        if (cellA.size > cellB.size * EAT_THRESHOLD) {
                            cellA.mass += cellB.mass;
                            cellA.size = Math.sqrt(cellA.mass / Math.PI);
                            playerA.score = cellA.mass;

                            // إزالة الخلية المأكولة من اللاعب B
                            playerB.cells = playerB.cells.filter(c => c.id !== cellB.id);

                        } else if (cellB.size > cellA.size * EAT_THRESHOLD) {
                            cellB.mass += cellA.mass;
                            cellB.size = Math.sqrt(cellB.mass / Math.PI);
                            playerB.score = cellB.mass;

                            // إزالة الخلية المأكولة من اللاعب A
                            playerA.cells = playerA.cells.filter(c => c.id !== cellA.id);
                        }
                    }
                });
            });

            // إزالة اللاعبين الذين لم يتبق لهم خلايا
            if (playerA.cells.length === 0) {
                delete players[playerA.id];
                if (playerA.ws) playerA.ws.close(); // إغلاق اتصال اللاعب البشري
                bots = bots.filter(id => id !== playerA.id); // إزالة من قائمة البوتات
            }
            if (playerB.cells.length === 0) {
                delete players[playerB.id];
                if (playerB.ws) playerB.ws.close();
                bots = bots.filter(id => id !== playerB.id);
            }
        }
    }
}


// ----------------------
// دالة تحديث اللعبة الرئيسية
// ----------------------

let lastTime = Date.now();

function updateGame() {
    const now = Date.now();
    const deltaTime = (now - lastTime) / 1000; // الفرق بالثواني
    lastTime = now;

    // 1. تحديث منطق البوتات
    updateBotAI();

    // 2. تحديث الحركة
    updateMovement(deltaTime);

    // 3. التحقق من الاصطدامات
    checkCollisions();

    // 4. إرسال حالة اللعبة المحدثة إلى جميع العملاء
    broadcastGameState();

    // 5. إعادة توليد البوتات المفقودة
    while (bots.length < BOT_COUNT) {
        createPlayer(true);
    }
}

// تشغيل حلقة اللعبة الرئيسية بمعدل 60 إطار في الثانية
setInterval(updateGame, GAME_TICK);


// ------------------------------------------------------------------
// منطق WebSocket
// ------------------------------------------------------------------

function broadcastGameState() {
    const leaderboard = Object.values(players)
        .filter(p => p.cells.length > 0)
        .map(p => ({ name: p.name, score: Math.floor(p.score) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    const state = {
        players: Object.values(players).map(p => ({
            id: p.id,
            name: p.name,
            cells: p.cells.map(c => ({
                x: Math.round(c.x),
                y: Math.round(c.y),
                size: Math.round(c.size),
                color: c.color
            }))
        })),
        food: food.map(f => ({
            x: Math.round(f.x),
            y: Math.round(f.y),
            color: f.color
        })),
        leaderboard: leaderboard,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT
    };

    const message = JSON.stringify(state);

    // إرسال حالة اللعبة إلى كل لاعب متصل
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', function connection(ws, req) {
    console.log('Client connected from:', req.headers['x-forwarded-for'] || req.socket.remoteAddress);

    // إنشاء لاعب جديد للاتصال
    const newPlayer = createPlayer(false);
    newPlayer.ws = ws; // ربط اتصال WebSocket بكائن اللاعب
    console.log(`New player created with ID: ${newPlayer.id}`);

    // إرسال معلومات اللاعب إلى العميل
    ws.send(JSON.stringify({ type: 'init', playerId: newPlayer.id }));

    // معالجة الرسائل الواردة
    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);

            if (data.type === 'move' && newPlayer.cells.length > 0) {
                // تحديث موقع الهدف للاعب
                newPlayer.targetX = data.x;
                newPlayer.targetY = data.y;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    // معالجة قطع الاتصال
    ws.on('close', () => {
        console.log(`Player ${newPlayer.id} disconnected.`);
        // إزالة اللاعب من قائمة اللاعبين
        delete players[newPlayer.id];
    });

    // معالجة الأخطاء
    ws.on('error', (err) => {
        console.error(`WebSocket error for player ${newPlayer.id}:`, err);
    });
});

// ----------------------
// تشغيل الخادم
// ----------------------
server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    console.log(`WebSocket connections should use WSS at: wss://${USER_SERVER_DOMAIN}`);
    
    // تهيئة اللعبة عند بدء تشغيل الخادم
    initializeFood();
    for (let i = 0; i < BOT_COUNT; i++) {
        createPlayer(true);
    }
});
