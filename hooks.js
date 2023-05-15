import Settings from "./settings.js";

function updateCombatantReactionState(combatant, newState) {
    combatant.token.update({
        "flags.reaction-check.state": newState
    });
}

function getEnemyDistance(tcenter, dcenter) {
    var distance = canvas.grid.measureDistance(tcenter, dcenter);
    return Math.round(distance / 5) * 5
}

function getCenterObj(x, y) {
    var a = canvas.grid.getCenter(x, y)
    return {"x": a[0],"y": a[1]}
}

function getCenters(x, y, width) {
    var startY = y;
    var arr = [];

    for (let i = 0; i < width; i++) {
        for (let j = 0; j < width; j++) {
            arr.push(getCenterObj(x,y));
            y += 100;
        }
        y = startY;
        x += 100;
    }
    return arr
}

async function postInChatTemplate(template, token) {
    const content = await renderTemplate("./modules/pf2e-reaction/templates/"+template+".hbs", { token: token });
    ChatMessage.create({
        content: content,
        whisper: game.users.filter(u => u.isGM).map(u => u._id),
        flags: {
            "reaction-check": {
                tokenId: token.id
            }
        }
    });
}

function checkCombatantTriggerAttackOfOpportunity(actorType, actorId, x, y, width) {
    var filteredType = ((actorType  == "npc") ? 'character' : 'npc')
    game?.combats?.active?.combatants
        .filter((c=>c.actorId != actorId && c.actor.type == filteredType && c.token.flags?.["reaction-check"]?.state))
        .filter((cc=>cc.actor.itemTypes.action.find((feat => "attack-of-opportunity" === feat.slug))))
        .forEach(cc => {
            var hasStrike = cc.token.actor.system.actions?.filter((e=>"strike"===e.type && e.ready));
            if (hasStrike.length>0) {
                var isReach = actorType  == "npc"
                    ? hasStrike.filter((e=>e.weaponTraits.find(b=>b.name==="reach")))
                    : hasStrike.filter((e=>e.traits.find(b=>b.name.startsWith("reach"))));
                var canAttack = getCenters(x, y, width)
                    .map(a=>getEnemyDistance(cc.token.center, a))
                    .filter(a=> (a <= (isReach.length>0?Settings.weaponReachRange:Settings.weaponRange)))
                if (canAttack.length>0) {
                        postInChatTemplate("attack-of-opportunity", cc.token);
                }
            }
        })
}

export default function reactionHooks() {

    console.log("Pf2e-reaction | --- Add hooks");

    $(document).on('click', '.reaction-check', function () {
        var mid = $(this).parent().parent().data('message-id');
        if (mid) {
            var mes = game.messages.get(mid);
            var t = mes.flags['reaction-check'].tokenId;
            if (t) {
                var combatant = game.combat.turns.find(a=>a.tokenId === t);
                if (combatant) {
                    updateCombatantReactionState(combatant, false);
                    ui.chat.deleteMessage(mid, {})
                }
            }
        }

    });

    Hooks.on('combatRound', async combat => {
        combat.turns.forEach(cc =>{
            updateCombatantReactionState(cc, true)
        })
    });

    Hooks.on('deleteCombat', async combat => {
        combat.turns.forEach(cc =>{
            updateCombatantReactionState(cc, false)
        })
    });

    Hooks.on('createCombatant', async combatant => {
        updateCombatantReactionState(combatant, true)
    });

    Hooks.on('preCreateChatMessage',(message, user, _options, userId)=>{
        if (game?.combats?.active) {
            if (
                ('attack-roll' == message?.flags?.pf2e?.context?.type && message?.flags?.pf2e?.context?.domains.includes("ranged-attack-roll"))
                || (message?.item?.type == 'action' && message?.item?.system?.traits?.value.includes("manipulate"))
            ) {
                checkCombatantTriggerAttackOfOpportunity(message.actor?.type, message.actor._id, message.token.x, message.token.y, message.token.width);
            } else if (user?.flags?.pf2e?.origin?.type == 'action') {
                var actId = user.flags?.pf2e?.origin?.uuid.split('.').slice(-1)
                if (game?.packs?.get("pf2e.actionspf2e")._source.find(a=>a._id==actId).system?.traits?.value.includes("manipulate")) {
                    checkCombatantTriggerAttackOfOpportunity(message.actor?.type, message.actor._id, message.token.x, message.token.y, message.token.width);
                }
            }
            //Hit by
            if ('attack-roll' == message?.flags?.pf2e?.context?.type
                && ("success" == message?.flags?.pf2e?.context?.outcome || "criticalSuccess" == message?.flags?.pf2e?.context?.outcome)
            ) {
                if (message.target.token.flags?.["reaction-check"]?.state) {
                    //wicked-thorns
                    if (message?.item?.traits.has("unarmed") || (message?.item?.isMelee && !message?.item?.traits.has("reach"))) {
                        postInChatTemplate("wicked-thorns", message.target.token);
                    }
                }
            }
        }
    });

    Hooks.on('preUpdateToken',(_document, update, options, ..._args)=>{
        if (game?.combats?.active && (update.x > 0 || update.y > 0)) {
            checkCombatantTriggerAttackOfOpportunity(_document.actor?.type, _document.actorId, _document.x,_document.y,_document.width);
        }
    });

    console.log("Pf2e-reaction | --- Hooks are added");
}