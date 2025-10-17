// --- إعدادات الخادم والتبعيات ---
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// رابط الخادم الخاص بك على Render لضمان اتصال WSS الآمن
const USER_SERVER_DOMAIN = 'bouhzila-io-1.onrender.com';
const PORT = process.env.PORT || 10000;

// مسار الملفات الثابتة (واجهة اللعبة)
app.use(express.static(path.join(__dirname, 'public')));

// --- إعدادات اللعبة العامة ---
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const MAX_FOOD = 500;
const MAX_BOTS = 15;
const GAME_SPEED = 1000 / 60; // 60 إطار في الثانية

// --- هياكل بيانات اللعبة ---
let players = {};
let food = [];
let nextFoodId = 0;
let nextPlayerId = 1;

// --- دالة إضافة الطعام (Food) ---
function addFood() {
    if (food.length < MAX_FOOD) {
        food.push({
            id: nextFoodId++,
            x: Math.random() * MAP_WIDTH - MAP_WIDTH / 2,
            y: Math.random() * MAP_HEIGHT - MAP_HEIGHT / 2,
            size: 10,
            color: getRandomColor()
        });
    }
}

// --- دالة توليد لون عشوائي ---
function getRandomColor() {
    const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#FFA500', '#800080'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// --- دالة إنشاء لاعب/خلية (Player/Cell) ---
function createCell(id, x, y, size, name, isBot = false) {
    return {
        id,
        x,
        y,
        size,
        color: getRandomColor(),
        name: name,
        isBot: isBot,
        targetX: x,
        targetY: y,
        lastSplitTime: Date.now()
    };
}

// --- دالة إضافة لاعب جديد (للإنسان والروبوت) ---
function addPlayer(name, isBot = false) {
    const id = nextPlayerId++;
    const x = Math.random() * MAP_WIDTH - MAP_WIDTH / 2;
    const y = Math.random() * MAP_HEIGHT - MAP_HEIGHT / 2;
    const size = isBot ? 20 : 30; // الروبوتات تبدأ أصغر قليلاً

    players[id] = {
        id: id,
        name: name,
        isBot: isBot,
        cells: [createCell(id, x, y, size, name, isBot)],
        targetX: x,
        targetY: y,
        score: size * size // النتيجة هي الحجم المربع
    };
    return players[id];
}

// --- منطق الذكاء الاصطناعي للبوتات (Bot AI Logic) ---
function updateBot(bot) {
    let bestTarget = null;
    let minDistance = Infinity;
    const botCell = bot.cells[0]; // البوتات تبدأ بخلية واحدة فقط للتبسيط

    // 1. الأولوية لأكل الطعام
    for (const f of food) {
        const dist = Math.sqrt(Math.pow(f.x - botCell.x, 2) + Math.pow(f.y - botCell.y, 2));
        if (dist < minDistance && dist < 500) {
            minDistance = dist;
            bestTarget = f;
        }
    }

    // 2. إذا لم يكن هناك طعام قريب، ابحث عن لاعب أصغر (أو خلية أصغر)
    if (!bestTarget) {
        for (const pid in players) {
            const potentialVictim = players[pid];
            if (potentialVictim.id !== bot.id && potentialVictim.cells.length > 0) {
                const victimCell = potentialVictim.cells[0];
                // يمكن الأكل إذا كان حجم خلية البوت أكبر بنسبة 10%
                if (botCell.size * 1.1 < victimCell.size) continue;

                const dist = Math.sqrt(Math.pow(victimCell.x - botCell.x, 2) + Math.pow(victimCell.y - botCell.y, 2));
                if (dist < minDistance && dist < 800) {
                    minDistance = dist;
                    bestTarget = victimCell;
                }
            }
        }
    }

    // 3. تحديد نقطة التحرك
    if (bestTarget) {
        bot.targetX = bestTarget.x;
        bot.targetY = bestTarget.y;
    } else {
        // تحرك عشوائي إذا لم يكن هناك هدف
        if (Math.random() < 0.05) {
            bot.targetX = botCell.x + (Math.random() - 0.5) * 500;
            bot.targetY = botCell.y + (Math.random() - 0.5) * 500;
        }
    }

    // الهروب من الخطر (منطق بسيط)
    // يمكن إضافة منطق هروب متقدم هنا لاحقاً

    // تطبيق الحركة
    const speed = Math.max(2, 5 / Math.sqrt(botCell.size / 30));
    const dx = bot.targetX - botCell.x;
    const dy = bot.targetY - botCell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1) {
        botCell.x += (dx / dist) * speed;
        botCell.y += (dy / dist) * speed;
    }

    // تطبيق حدود الخريطة
    botCell.x = Math.max(Math.min(botCell.x, MAP_WIDTH / 2), -MAP_WIDTH / 2);
    botCell.y = Math.max(Math.min(botCell.y, MAP_HEIGHT / 2), -MAP_HEIGHT / 2);
}

// --- دالة الحركة الأساسية (لكل الخلايا) ---
function moveCell(cell, targetX, targetY) {
    const speed = Math.max(2, 5 / Math.sqrt(cell.size / 30));
    const dx = targetX - cell.x;
    const dy = targetY - cell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1) {
        cell.x += (dx / dist) * speed;
        cell.y += (dy / dist) * speed;
    }

    // تطبيق حدود الخريطة
    cell.x = Math.max(Math.min(cell.x, MAP_WIDTH / 2), -MAP_WIDTH / 2);
    cell.y = Math.max(Math.min(cell.y, MAP_HEIGHT / 2), -MAP_HEIGHT / 2);
}

// --- دالة الكشف عن الاصطدام والأكل ---
function checkCollisions() {
    // 1. اصطدام الخلايا مع الطعام
    for (const playerId in players) {
        const player = players[playerId];
        player.cells.forEach(cell => {
            for (let i = food.length - 1; i >= 0; i--) {
                const f = food[i];
                const distance = Math.sqrt(Math.pow(cell.x - f.x, 2) + Math.pow(cell.y - f.y, 2));

                if (distance < cell.size) { // إذا حدث اصطدام
                    cell.size += 1; // زيادة الحجم
                    player.score += 1;
                    food.splice(i, 1); // إزالة الطعام
                    addFood(); // إضافة طعام جديد فوراً
                }
            }
        });
    }

    // 2. اصطدام الخلايا مع بعضها البعض (الأكل)
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
        const playerA = players[playerIds[i]];
        for (let j = i; j < playerIds.length; j++) {
            if (i === j) continue; // لا تتفحص الاصطدام مع نفس اللاعب

            const playerB = players[playerIds[j]];

            playerA.cells.forEach(cellA => {
                playerB.cells.forEach(cellB => {
                    const distance = Math.sqrt(Math.pow(cellA.x - cellB.x, 2) + Math.pow(cellA.y - cellB.y, 2));

                    // يمكن لـ A أن يأكل B إذا كان حجم A أكبر بنسبة 10%
                    if (cellA.size > cellB.size * 1.1 && distance < cellA.size) {
                        cellA.size += Math.sqrt(cellB.size); // زيادة الحجم
                        playerA.score += cellB.size * cellB.size;
                        // إزالة الخلية المأكولة
                        playerB.cells.splice(playerB.cells.indexOf(cellB), 1);
                    }
                    // يمكن لـ B أن يأكل A إذا كان حجم B أكبر بنسبة 10%
                    else if (cellB.size > cellA.size * 1.1 && distance < cellB.size) {
                        cellB.size += Math.sqrt(cellA.size); // زيادة الحجم
                        playerB.score += cellA.size * cellA.size;
                        // إزالة الخلية المأكولة
                        playerA.cells.splice(playerA.cells.indexOf(cellA), 1);
                    }
                });
            });

            // إزالة اللاعبين الذين فقدوا كل خلاياهم
            if (playerA.cells.length === 0) delete players[playerA.id];
            if (playerB.cells.length === 0) delete players[playerB.id];
        }
    }
}

// --- دالة الانقسام (Splitting) ---
function splitCell(player, cellId, targetX, targetY) {
    const originalCell = player.cells.find(c => c.id === cellId);

    if (!originalCell || originalCell.size < 40 || player.cells.length >= 16) {
        return; // لا يمكن الانقسام إذا كانت الخلية صغيرة جداً أو كان اللاعب لديه 16 خلية
    }

    const newSize = originalCell.size / 2;
    originalCell.size = newSize;

    const dx = targetX - originalCell.x;
    const dy = targetY - originalCell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const splitDistance = newSize * 3; // المسافة التي ستنطلق فيها الخلية الجديدة

    const newCellX = originalCell.x + (dx / dist) * splitDistance;
    const newCellY = originalCell.y + (dy / dist) * splitDistance;

    const newCell = createCell(
        nextPlayerId++,
        newCellX,
        newCellY,
        newSize,
        player.name,
        player.isBot
    );

    // الخلية المنقسمة تنطلق في اتجاه مؤشر الفأرة/الهدف
    newCell.targetX = newCellX + (dx / dist) * 100;
    newCell.targetY = newCellY + (dy / dist) * 100;

    player.cells.push(newCell);
}

// --- دالة تحديث حالة اللعبة (Game Loop) ---
function updateGame() {
    // تحديث الروبوتات
    for (const id in players) {
        const player = players[id];
        if (player.isBot) {
            updateBot(player);
            // تطبيق الحركة على خلايا البوتات
            player.cells.forEach(cell => {
                moveCell(cell, player.targetX, player.targetY);
            });
        } else {
            // تطبيق الحركة على خلايا اللاعبين البشر
            player.cells.forEach(cell => {
                moveCell(cell, player.targetX, player.targetY);
            });
        }
    }

    // التحقق من الاصطدامات (أكل الطعام واللاعبين)
    checkCollisions();

    // إضافة روبوتات جديدة إذا لزم الأمر
    const botCount = Object.values(players).filter(p => p.isBot).length;
    if (botCount < MAX_BOTS) {
        addPlayer('Bot ' + (botCount + 1), true);
    }

    // تجميع البيانات لإرسالها للعملاء
    const leaderboard = Object.values(players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => ({ name: p.name, score: Math.round(p.score) }));

    const gameState = {
        players: Object.values(players).flatMap(p => p.cells), // إرسال الخلايا فقط
        food: food,
        leaderboard: leaderboard
    };

    // إرسال حالة اللعبة لكل العملاء
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });
}

// إضافة الطعام الأولي
for (let i = 0; i < MAX_FOOD; i++) {
    addFood();
}

// بدء حلقة اللعبة
setInterval(updateGame, GAME_SPEED);

// --- التعامل مع اتصال WebSocket ---
wss.on('connection', function connection(ws) {
    let playerId = null;

    // استقبال رسائل من العميل
    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                // رسالة تهيئة (تسجيل الدخول)
                const newPlayer = addPlayer(data.name || 'Anonymous');
                playerId = newPlayer.id;

                // إرسال معلومات اللاعب الجديد للعميل
                ws.send(JSON.stringify({ type: 'init', id: playerId, mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT }));
            } else if (data.type === 'move' && playerId) {
                // رسالة حركة (تحديث موقع الفأرة)
                const player = players[playerId];
                if (player) {
                    player.targetX = data.x;
                    player.targetY = data.y;
                }
            } else if (data.type === 'split' && playerId) {
                // رسالة انقسام
                const player = players[playerId];
                if (player && player.cells.length > 0) {
                    // انقسام الخلية الأكبر (أو كل الخلايا لاحقاً)
                    player.cells.forEach(cell => {
                        splitCell(player, cell.id, player.targetX, player.targetY);
                    });
                }
            }
        } catch (e) {
            // console.error('Error parsing message:', e);
        }
    });

    // عند إغلاق الاتصال
    ws.on('close', () => {
        if (playerId) {
            delete players[playerId]; // إزالة اللاعب من الخادم
        }
    });
});

// --- بدء خادم HTTP والاستماع للمنفذ ---
server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    console.log(`WebSocket connections should use WSS at: wss://${USER_SERVER_DOMAIN}`);
});
