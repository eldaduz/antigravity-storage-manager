const fs = require('fs');
const path = require('path');

const newKeys = {
    "ar": {
        "Reindex Conversations": "إعادة فهرسة المحادثات",
        "Fix missing conversations from other devices": "إصلاح المحادثات المفقودة من أجهزة أخرى"
    },
    "cs": {
        "Reindex Conversations": "Přeindexovat konverzace",
        "Fix missing conversations from other devices": "Opravit chybějící konverzace z jiných zařízení"
    },
    "de": {
        "Reindex Conversations": "Unterhaltungen neu indizieren",
        "Fix missing conversations from other devices": "Fehlende Unterhaltungen von anderen Geräten beheben"
    },
    "es": {
        "Reindex Conversations": "Reindexar conversaciones",
        "Fix missing conversations from other devices": "Arreglar conversaciones faltantes de otros dispositivos"
    },
    "fr": {
        "Reindex Conversations": "Réindexer les conversations",
        "Fix missing conversations from other devices": "Corriger les conversations manquantes d'autres appareils"
    },
    "it": {
        "Reindex Conversations": "Reindicizza conversazioni",
        "Fix missing conversations from other devices": "Correggi conversazioni mancanti da altri dispositivi"
    },
    "ja": {
        "Reindex Conversations": "会話の再インデックス",
        "Fix missing conversations from other devices": "他のデバイスからの欠落した会話を修復"
    },
    "ko": {
        "Reindex Conversations": "대화 색인 재생성",
        "Fix missing conversations from other devices": "다른 장치의 누락된 대화 수정"
    },
    "pl": {
        "Reindex Conversations": "Przeindeksuj konwersacje",
        "Fix missing conversations from other devices": "Napraw brakujące konwersacje z innych urządzeń"
    },
    "pt-br": {
        "Reindex Conversations": "Reindexar conversas",
        "Fix missing conversations from other devices": "Corrigir conversas ausentes de outros dispositivos"
    },
    "ru": {
        "Reindex Conversations": "Переиндексировать беседы",
        "Fix missing conversations from other devices": "Исправить отсутствующие беседы с других устройств"
    },
    "tr": {
        "Reindex Conversations": "Konuşmaları Yeniden Dizine Ekle",
        "Fix missing conversations from other devices": "Diğer cihazlardan eksik konuşmaları düzelt"
    },
    "vi": {
        "Reindex Conversations": "Lập lại chỉ mục cuộc hội thoại",
        "Fix missing conversations from other devices": "Sửa các cuộc hội thoại bị thiếu từ các thiết bị khác"
    },
    "zh-cn": {
        "Reindex Conversations": "重新索引对话",
        "Fix missing conversations from other devices": "修复来自其他设备的缺失对话"
    },
    "zh-tw": {
        "Reindex Conversations": "重新索引對話",
        "Fix missing conversations from other devices": "修復來自其他裝置的缺失對話"
    }
};

const l10nDir = path.join(__dirname);
const files = fs.readdirSync(l10nDir).filter(f => f.startsWith('bundle.l10n.') && f.endsWith('.json') && f !== 'bundle.l10n.json');

files.forEach(file => {
    const langCode = file.replace('bundle.l10n.', '').replace('.json', '');
    if (newKeys[langCode]) {
        const filePath = path.join(l10nDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        Object.keys(newKeys[langCode]).forEach(key => {
            content[key] = newKeys[langCode][key];
        });

        fs.writeFileSync(filePath, JSON.stringify(content, null, 4), 'utf8');
        console.log(`Updated ${file}`);
    } else {
        console.warn(`No translations provided for ${langCode}, skipping...`);
    }
});
