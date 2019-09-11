function DataAccess() {
    var apiSource = "https://netrunnerdb.com/api/2.0/public/cards";
    var packsApiSource = "https://netrunnerdb.com/api/2.0/public/packs";
    var prebuiltsApiSource = "https://netrunnerdb.com/api/2.0/public/prebuilts";
    this.LoadCards = function (that, callback) {
        $.getJSON(apiSource, callback);
    };
    this.LoadPacks = function (that, callback) {
        $.getJSON(packsApiSource, callback);
    };
    this.LoadPrebuilts = function (that, callback) {
        $.getJSON(prebuiltsApiSource, callback);
    };
}

var myCardCollection = null; // Instance of CardCollection contains all card information and generates draft picks from the available cards
var myArenaScript = null; // Instance of Script contains and handles the draft pick logic
var myDeckList = null; // Instance of deckList contains and handles all picked card information
var dataAccess = new DataAccess();
var preferences = { //Global settings
    "deckSize": 30, // to be used with drafting ID
    "setFilter": "collection", // default card filter can be "" for all packs, "released" for released packs, "collection" for cards only in your collection or an array of pack codes
    "collection": ["core2", "td", "hap", "oac", "qu", "ss", "dtwn", "cotc", "2016-world-champion-runner-deck" ], // the list of packs in your collection
    "econPicks": 9, // minimum econ picks
    "corePicks": 4, // minimun core set picks
    "limitOne": true, // if set to true, all 1ofs will be removed from the pool once one of them has been selected
    "limitAll": true, // if set to true, all card will be removed from the pool once they reach their default deck limit
    "softLimit": false, // if set to true, cards will become increasingly rare each time they are picked after they reach their default deck limit
    "consoleSoftLimit": true, // if set to true, after selecting a console all others will become more rare, and it more common
    "weightCode": "influence-weights-faction-bonus", // currently selected weight algorithm to allow for different weight systems
    "pickOptions": 4, // number of cards to pick from on selection screen
    "draftBlockedCards": ["06025", "09053", "10073", "10083"] // list of card codes to be banned with draft ids (Cerebral Static, Employee Strike, Indian Union Stock Exchange and Rebirth)
};
var releasedSets = []; // list of currently released data packs (automatically populated from NetrunnerDB)
var imageURLTemplate = "";

// This is a list of cards that should be removed from the card pool after it is initialized.
const cardsToBeRemoved = [];

function CardCollection(data, setFilter) {
    /*
     * Object to manage the available cardlist
     * Contains all card information
     * After initialised by starting a draft
     *  it's data can be found in the myCardCollection instance
     */
    var cardSets = {
        ids: {runner: [], corp: [], draft: []},
        runner: [],
        corp: [],
        agendas: []
    };
    var allowedSets = [];
    if (setFilter instanceof Array) {
        allowedSets = setFilter;
    } else if (setFilter === "released") {
        allowedSets = releasedSets;
    } else if (setFilter === "collection") {
        allowedSets = preferences.collection;
        $.each(data, function (key, value) {
            value.remaining = value["quantity"] * preferences.collection.filter(pack_code => pack_code === value["pack_code"]).length;
        });
    }

    $.each(data, function (key, value) {
        if (value["pack_code"] === "draft") {
            cardSets.ids.draft.push(value);
        } else {
            if (filterFunctions.checkAllowed(allowedSets, value)) {
                switch (value["type_code"]) {
                    case "identity":
                        if (value["side_code"] === "corp") {
                            cardSets.ids.corp.push(value);
                        } else {
                            cardSets.ids.runner.push(value);
                        }
                        break;
                    case "agenda":
                        if (value["agenda_points"] > 0) {
                            cardSets.agendas.push(value);
                        } else {
                            cardSets.corp.push(value);
                        }
                        break;
                    default:
                        if (value["side_code"] === "corp") {
                            cardSets.corp.push(value);
                        } else {
                            cardSets.runner.push(value);
                        }
                        break;
                }
            }
        }
    }
    );
    this.setWeights = function (cardPoolCode, weightCode, faction) {
        var cardPool = filterFunctions.getCardPool(cardSets, cardPoolCode);
        $.each(cardPool, function (key, value) {
            value.weight = filterFunctions.weight(value, weightCode, faction);
        });
    };

    this.multiplyWeight = function (cardPoolCode, cardCode, multiplier) {
        card = this.getCard(cardPoolCode, cardCode);
        if (typeof card["weight"] !== "undefined") {
            card.weight = Math.max(Math.floor(card.weight * multiplier), 1);
        } else {
            card.weight = 1;
        }
    };
    this.consoleSoftLimit = function (cardCode) {
        var cardPool = filterFunctions.getCardPool(cardSets, "runner");
        $.each(cardPool, function (key, value) {
            if (filterFunctions.checkFilter(value, "console")) {
                if (value.code === cardCode) {
                    myCardCollection.multiplyWeight("runner", value.code, 1.5);
                } else {
                    myCardCollection.multiplyWeight("runner", value.code, 0.5);
                }
            }
        });

    };
    this.createSet = function (cardPoolCode, filters, count, weightCode, blackList, faction, influence, agendaPoints) {
        var cardPool = filterFunctions.getCardPool(cardSets, cardPoolCode);
        var results = [];
        var resultCodes = [];
        for (i = 0; i < 10; i++) {
            if (resultCodes.length >= count) {

                break;
            }
            var weightedArray = [];
            $.each(cardPool, function (key, value) {
                if (resultCodes.includes(value.code)) {
                    return true;
                }
                if (blackList.includes(value.code)) {
                    return true;
                }
                if (typeof filters[i] !== 'undefined') {
                    if (!filterFunctions.checkFilter(value, filters[i], agendaPoints)) {
                        return true;
                    }
                }
                if (influence >= 0) {
                    if (!((value["faction_code"] === faction) || (value["faction_cost"] <= influence) || (myDeckList.alliances().includes(value["code"])))) {
                        return true;
                    }
                }
                if (typeof value["weight"] === 'undefined') {
                    value["weight"] = filterFunctions.weight(value, weightCode, faction);
                }
                for (j = 0; j < value["weight"]; j++) {
                    weightedArray.push(value.code);
                }

            });

            resultCodes = filterFunctions.getRandomCards(resultCodes, weightedArray, count - resultCodes.length);
        }
        $.each(resultCodes, function (key, value) {
            results.push(filterFunctions.getCard(cardPool, value));
        });
        return results;
    };
    this.getCard = function (cardPoolCode, cardCode) {
        return filterFunctions.getCard(filterFunctions.getCardPool(cardSets, cardPoolCode), cardCode);
    };
    this.removeCopyFromCollection = function (cardPoolCode, cardCode) {
        let card = this.getCard(cardPoolCode, cardCode);
        card.remaining--;
        if (card.remaining === 0) {
            myArenaScript.blockCard(cardCode);
        }
    };
    this.removeCopyFromSomewhereInCollection = function (cardCode) {
        const cardPoolCodes = [ "runner", "corp", "runner-id", "corp-id", "agendas", "draft-id" ];
        for (const cardPoolCode of cardPoolCodes) {
            const card = this.getCard(cardPoolCode, cardCode);
            if (card !== null) {
                this.removeCopyFromCollection(cardPoolCode, cardCode);
            }
        }
    };
    this.blockJintekiCards = function () {
        $.each(cardSets.corp.concat(cardSets.agendas), function (key, value) {
            if (value.faction_code === "jinteki") {
                myArenaScript.blockCard(value.code);
            }
        });
    };
    this.setProfessorAlliances = function () {
        $.each(cardSets.runner, function (key, value) {
            if (filterFunctions.checkFilter(value, "program") && (value.faction_code !== "shaper" || value.faction_code !== "neutral")) {
                myDeckList.setAlliance(value.code);
            }
        });
    };
}



var views = {
    /*
     * Object to manage the visual content of the main view area (the #Arena div)
     */
    selectType: function () {
        var html = '<div class="select-container type"><h2>Select Format:</h2>';
        html += '<a class="select-box type draft-id" href="javascript:views.selectSide(\'draftid\')">Use Draft ID</a>';
        html += '<a class="select-box type select-id" href="javascript:views.selectSide(\'selectid\')">Draft An ID</a>';
        html += '</div>';
        $("#Arena").html(html);
    },
    selectSide: function (formatCode) {
        var html = '<div class="select-container sides"><h2>Pick a side:</h2>';
        html += '<a class="select-box type corp ' + formatCode + '" href="javascript:views.startDraft(\'corp\',\'' + formatCode + '\')">Corporation</a>';
        html += '<a class="select-box type runner  ' + formatCode + '" href="javascript:views.startDraft(\'runner\',\'' + formatCode + '\')">Runner</a>';
        html += '</div>';
        $("#Arena").html(html);
    },
    startDraft: function (sideCode, formatCode) {
        myArenaScript = new Script(sideCode, formatCode);
        dataAccess.LoadPacks(dataAccess, onPacksDataAvaliable);
        console.log("document loaded");
    },
    publishChoice: function (picks, cardPoolCode) {
        currentPicks = picks;
        var selected = [];
        $.each(picks, function (key, value) {
            selected.push("<a href=\"javascript:views.picked('" + value.code + "','" + cardPoolCode + "')\"><img class='pickImg' src='" + cardImageURL(value) + "' alt='" + value.title + "'></a>");
        });
        $("#Arena").html(selected.join(""));
    },
    picked: function (code, cardPoolCode) {
        pickedCard = myCardCollection.getCard(cardPoolCode, code);
        if (pickedCard.type_code === "identity") {
            if (pickedCard.influence_limit !== null) {
                myArenaScript.setDeckSize(pickedCard.minimum_deck_size);
                if (pickedCard.code === "03002") {
                    myCardCollection.blockJintekiCards();
                } else if (pickedCard.code === "03029") {
                    myDeckList.setProfessorRules();
                }
            }
        } else if (pickedCard.type_code === "agenda") {
            myArenaScript.pickedAgendaPoints(pickedCard.agenda_points);
        }
        myDeckList.push(pickedCard);
        if (preferences.setFilter === "collection") {
            myCardCollection.removeCopyFromCollection(cardPoolCode, code);
        }
        if (pickedCard.type_code === "identity") {
            if ((pickedCard.influence_limit === null && ['00006', '00005'].includes(pickedCard.code)) || (pickedCard.influence_limit !== null)) {
                myArenaScript.schedulePicks();
            }
        }
        myArenaScript.nextPicks();
    },
    draftDone: function () {
        if (myDeckList.idCode() === '00006') {
            views.publishChoice(myCardCollection.createSet("draft-id", ["runner"], 3, "", ["00006"], "", -1), "draft-id");
        } else if (myDeckList.idCode() === '00005') {
            views.publishChoice(myCardCollection.createSet("draft-id", ["corp"], 4, "", ["00005"], "", -1), "draft-id");
        } else {
            $("#Arena").html("<div class=\"allDone\" >Your deck is done. Take it to Jinteki and look for games named \"Arena\"</div>");
        }
    },
    loadCardPopups: function () {
        $(".card").mouseenter(function (event) {
            event.stopPropagation();
            var position = $(this).offset();
            $("#cardPopup").css("background-image", "url(" + $(this).data('card_image_url') + " )");
            $("#cardPopup").css("top", (position.top));
            $("#cardPopup").css("left", position.left + $(this).width());
            $("#cardPopup").show();
        });
        $(".card").mouseleave(function () {
            $("#cardPopup").hide();
        });
    },
    deckAreaContent: function (displaycode) {
        switch (displaycode) {

            case "decklist":
                myDeckList.print();
                break;
            case "about":
                $("#DeckList").load("_textPages/about.html");
                break;
            default:
                $("#DeckList").load("_textPages/home-page.html");
                dataAccess.LoadPacks(dataAccess, function (packsData) {
                    dataAccess.LoadPrebuilts(dataAccess, function (prebuiltsData) {
                        var names = [];
                        for (var code of preferences.collection) {
                            var packs = packsData.data.concat(prebuiltsData.data);

                            var pack = packs.find(p => p.code === code);
                            if (pack !== undefined) {
                                names.push(pack.name);
                            }
                        }

                        var list = $("<ul>").append(names.map(n => $("<li>").text(n)));

                        $("#AllowedPacks").empty().append("Allowed packs:", list);
                    });
                });
                break;

        }
    }

};
function deckList(targetDiv) {
    /*
     * Object to manage the created decklist
     * Contains all selected card information
     * After initialised by starting a draft
     * it's data can be found in the myDeckList instance
     */
    var MyCards = {};
    var deckSize = 0;
    var maxInfluence = -1;
    var fact = "";
    var usedInfluence = 0;
    var allianceCodes = [];
    var isSpecialId = "";

    this.setProfessorRules = function () {
        isSpecialId = "Professor";
        myCardCollection.setProfessorAlliances();
    };

    this.alliances = function () {
        return allianceCodes;
    };
    this.removeAlliance = function (code) {
        allianceCodes[code] = null;
    };
    this.setAlliance = function (code) {
        allianceCodes[code] = code;
    };
    this.setUsedInfluence = function (value) {
        usedInfluence = value;
    };
    this.addUsedInfluence = function (value) {
        usedInfluence += value;
    };
    this.influence = function () {
        if (maxInfluence < 0) {
            return maxInfluence;
        } else {
            return maxInfluence - usedInfluence;
        }
    };
    this.faction = function () {
        return fact;
    };
    this.cards = function () {
        return MyCards;
    };
    this.idCode = function () {
        return Object.keys(MyCards["identity"])[0];
    };
    this.idCard = function () {
        return MyCards["identity"][Object.keys(MyCards["identity"])[0]];
    };
    this.print = function () {
        /* 
         * Fill the deckList container
         *  deckSize in the number of currently used cards while myArenaScript.deckSize() the final deck size.
         *  maxInfluence is the influence limit for the ID, for draft Id it is set to -1.
         *  usedInfluence is the amount of used influence while this.influence() returns the available influence for the deck.
         */
        $("#DeckList").html("");
        deckListHeaderHtml = "<div  class=\"card identity ";
        if (typeof this.idCard() !== "undefined") {
            deckListHeaderHtml += this.idCard().faction_code + "\" data-cardcode=\"" + this.idCard().code + "\" data-card_image_url=\"" + cardImageURL(this.idCard()) + "\" > " + this.idCard().title + " (" + deckSize + "/" + myArenaScript.deckSize() + ")";
        } else {
            deckListHeaderHtml += "\" >Deck";
        }
        deckListHeaderHtml += "</div><br/>";
        $("#DeckList").html(deckListHeaderHtml);
        if (maxInfluence < 0) {
            $("#DeckList").append("<div class=\"influence-box\"> Influence Remaining : <span style=\"color:red;\" >&#8734;</span></div><br/>");
        } else {
            $("#DeckList").append("<div class=\"influence-box\"> Influence Remaining : <span style=\"color:red;\" >" + this.influence() + "</span>/" + maxInfluence + "</div><br/>");
        }
        $.each(MyCards, function (typeForPrint, cardsForPrint) {
            /* 
             * loop between card type of cards used in the deck (except identity)
             * current type title in lowercase can be found in the variable type
             */
            if (typeForPrint === "identity") {
                return true;
            }
            deckListTypeHtml = "";
            typeCardCount = 0;
            $.each(cardsForPrint, function (codeForPrint, cardForPrint) {
                /* 
                 * loop between all cards of a given type in the deck
                 * the object card contains all card info like in the nrdb API
                 * as well as the key count that contains the amount of times a card has been picked
                 * and the key usedInfluence that marks how much influence the copies of this card take from the deck.
                 */
                deckListTypeHtml += "<div class=\"card\" data-cardcode=\"" + cardForPrint.code + "\" data-card_image_url=\"" + cardImageURL(cardForPrint) + "\" >";

                deckListTypeHtml += "<span class=\"card-count\" >" + cardForPrint["count"] + "</span>  <span class=\"card-title " + cardForPrint["faction_code"] + "\" >" + cardForPrint["title"] + "</span>  <span class=\"card-pack\" >" + cardForPrint["pack_code"] + "</span> ";
                if (typeof cardForPrint["usedInfluence"] !== "undefined") {
                    for (i = 0; i < cardForPrint["usedInfluence"]; i++) {
                        deckListTypeHtml += "<span class=\"influence-dot\" >&#9679;</span>";
                    }
                }
                typeCardCount += cardForPrint["count"];
                deckListTypeHtml += "</div>";

            });
            typeTitle = typeForPrint[0].toUpperCase() + typeForPrint.substring(1);
            deckListTypeHtml = "<div class=\"type-block " + typeForPrint + " \"> <div class=\"type-title\" >" + typeTitle + " <span class=\"card-count\"> (" + typeCardCount + ")</span> </div>" + deckListTypeHtml + "</div>";
            $("#DeckList").append(deckListTypeHtml);
        });
        views.loadCardPopups();
    };
    this.calculateInfluence = function () {
        if (maxInfluence > 0) {
            myDeckList.setUsedInfluence(0);
            $.each(MyCards, function (cardTypeForInfluence, cardsForInfluence) {
                $.each(cardsForInfluence, function (cardCodeForInfluence, cardForInfluence) {
                    cardForInfluence.usedInfluence = 0;
                    if (!(cardForInfluence.faction_code === myDeckList.faction())) {
                        if (cardForInfluence.faction_cost > 0) {
                            if (isSpecialId === "Professor" && cardForInfluence.type_code === "program") {
                                cardForInfluence.usedInfluence = cardForInfluence.faction_cost * (cardForInfluence.count - 1);
                            } else {
                                cardForInfluence.usedInfluence = cardForInfluence.faction_cost * cardForInfluence.count;
                            }
                            myDeckList.addUsedInfluence(cardForInfluence.usedInfluence);
                        }
                    }
                });
            });
        }
    };
    this.push = function (pushedCard) {
        if (pushedCard.type_code !== "identity") {
            deckSize++;
        } else {
            MyCards["identity"] = {};
            if (pushedCard.influence_limit > 0) {
                fact = pushedCard.faction_code;
                maxInfluence = pushedCard.influence_limit;
            }
        }
        if (typeof MyCards[pushedCard.type_code] === "undefined") {
            MyCards[pushedCard.type_code] = {};
        }
        if (typeof MyCards[pushedCard.type_code][pushedCard.code] === "undefined") {
            pushedCard.count = 1;
            MyCards[pushedCard.type_code][pushedCard.code] = pushedCard;
        } else {
            MyCards[pushedCard.type_code][pushedCard.code]["count"] += 1;
        }
        if (isSpecialId === "Professor" && pushedCard.type_code === "program") {
            this.removeAlliance(pushedCard.code);
        }
        if (preferences.limitAll || (preferences.limitOne && (pushedCard.deck_limit === 1))) {
            if (MyCards[pushedCard.type_code][pushedCard.code]["count"] >= pushedCard.deck_limit) {
                myArenaScript.blockCard(pushedCard.code);
            }
        }
        if (preferences.softLimit) {
            if (MyCards[pushedCard.type_code][pushedCard.code]["count"] >= pushedCard.deck_limit && pushedCard.type_code !== "identity") {
                if (pushedCard.type_code === "agenda") {
                    myCardCollection.multiplyWeight("agendas", pushedCard.code, 0.5);
                } else {
                    myCardCollection.multiplyWeight(pushedCard.side_code, pushedCard.code, 0.5);
                }
            }
        }
        if (preferences.consoleSoftLimit) {
            if (filterFunctions.checkFilter(pushedCard, "console")) {
                myCardCollection.consoleSoftLimit(pushedCard.code);
            }
        }


        this.calculateInfluence();
        this.print();
    };

}


function Script(sideCode, formatCode) {
    var schedule = new Schedule();
    var deckS = preferences.deckSize;
    var blockedCodes = [];
    var agendaPoints = 0;
    var killedAgendaPicks = 0;
    var maxAgendaPoints = 0;
    this.start = function () {
        myDeckList = new deckList();
        if (formatCode === "draftid") {
            blockedCodes = preferences.draftBlockedCards;
            if (sideCode === "runner") {
                views.picked('00006', "draft-id");
            } else {
                views.picked('00005', "draft-id");
            }
        } else {
            blockedCodes = [];
            if (sideCode === "runner") {
                views.publishChoice(myCardCollection.createSet("runner-id", [], preferences.pickOptions, "", blockedCodes, "", -1), "runner-id");
            } else {
                views.publishChoice(myCardCollection.createSet("corp-id", [], preferences.pickOptions, "", blockedCodes, "", -1), "corp-id");
            }

        }
    };
    this.blockCard = function (code) {
        blockedCodes.push(code);
    };
    this.setDeckSize = function (num) {
        deckS = num;
        schedule.setSize(this.deckSize());
    };
    this.pickedAgendaPoints = function (value) {
        killedAgendaPicks = value - 1;
        agendaPoints += value;
    };
    this.deckSize = function () {
        if (sideCode === "runner") {
            return deckS;
        } else {
            return deckS + 4;
        }
    };
    this.nextPicks = function () {
        if (!schedule.picksLeft()) {
            views.draftDone();
            return false;
        }
        type = this.nextPickType();

        if (type === "agendas") {
            if (killedAgendaPicks > 0) {
                killedAgendaPicks -= 1;
                cards = myCardCollection.createSet(sideCode, [], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence());
                views.publishChoice(cards, sideCode);
            } else {
                cards = myCardCollection.createSet("agendas", ["agendas"], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence(), maxAgendaPoints - agendaPoints);
                views.publishChoice(cards, "agendas");
            }
        } else {
            switch (type) {
                case "rng":
                    cards = myCardCollection.createSet(sideCode, [], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence());
                    break;
                case "fracter":
                case "decoder":
                case "killer":
                    cards = myCardCollection.createSet(sideCode, [type, "AI", "program"], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence());
                    break;
                case "breaker":
                    cards = myCardCollection.createSet(sideCode, ["icebreaker", "program"], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence());
                    break;
                case "core":
                case "economy":
                case "hardware":
                case "ice":
                case "unique":
                    cards = myCardCollection.createSet(sideCode, [type], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence());
                    break;
                case "barrier":
                case "codegate":
                case "sentry":
                    cards = myCardCollection.createSet(sideCode, [type, "ice"], preferences.pickOptions, preferences.weightCode, blockedCodes, myDeckList.faction(), myDeckList.influence());
                    break;
                default:
                    console.log("Error: " + type + " not found");
            }
            views.publishChoice(cards, sideCode);
        }
    };
    this.schedulePicks = function () {
        schedule = new Schedule();
        if (sideCode === "runner") {
            schedule.setSize(deckS);
            schedule.pushPick("fracter");
            schedule.pushPick("killer");
            schedule.pushPick("decoder");
            schedule.pushPick("hardware");
            schedule.pushPick("hardware");
            schedule.pushPick("breaker");
            schedule.pushPick("breaker");
            schedule.pushPick("unique");
            for (i = 0; i < preferences.econPicks; i++) {
                if (schedule.notFull()) {
                    schedule.pushPick("economy");
                }
            }
            for (i = 0; i < preferences.corePicks; i++) {
                if (schedule.notFull()) {
                    schedule.pushPick("core");
                }
            }
            while (schedule.notFull()) {
                schedule.pushPick("rng");
            }
            myCardCollection.setWeights(sideCode, preferences.weightCode, myDeckList.faction());
        } else if (sideCode === "corp") {
            schedule.setSize(deckS + 4);
            killedAgendaPicks = 0;
            agendaPoints = 0;
            maxAgendaPoints = (((deckS) / 5) * 2) + 2;
            for (i = 0; i < maxAgendaPoints; i++) {
                schedule.pushPick("agendas");
            }
            schedule.pushPick("barrier");
            schedule.pushPick("barrier");
            schedule.pushPick("codegate");
            schedule.pushPick("codegate");
            schedule.pushPick("sentry");
            schedule.pushPick("sentry");
            schedule.pushPick("ice");
            schedule.pushPick("ice");
            schedule.pushPick("ice");
            schedule.pushPick("ice");
            schedule.pushPick("unique");
            for (i = 0; i < preferences.econPicks; i++) {
                if (schedule.notFull()) {
                    schedule.pushPick("economy");
                }
            }
            for (i = 0; i < preferences.corePicks; i++) {
                if (schedule.notFull()) {
                    schedule.pushPick("core");
                }
            }
            while (schedule.notFull()) {
                schedule.pushPick("rng");
            }
            myCardCollection.setWeights("agendas", preferences.weightCode, myDeckList.faction());
            myCardCollection.setWeights(sideCode, preferences.weightCode, myDeckList.faction());
        }


    };
    this.nextPickType = function () {
        return schedule.popPick();
    };
}



function Schedule() {
    var sched = [];
    var size = 0;
    var started = false;
    this.setSize = function (num) {
        size = num;
        started = true;
    };
    this.sched = function () {
        return sched;
    };
    this.picksLeft = function () {
        if (started) {
            return sched.length > 0;
        } else {
            return true;
        }
    };
    this.notFull = function () {
        return sched.length < size;
    };
    this.pushPick = function (pickCode) {
        sched.splice(Math.floor(Math.random() * sched.length), 0, pickCode);
    };
    this.popPick = function () {
        return sched.pop();
    };
}




var filterFunctions = {
    checkAllowed: function (allowedSets, card) {
        if (allowedSets.length === 0) {
            return true;
        }
        if (allowedSets.includes(card["pack_code"])) {
            return true;
        }
        return false;
    },
    getCard: function (cardPool, cardCode) {
        var result = null;
        $.each(cardPool, function (key, value) {
            if (value["code"] === cardCode) {
                result = value;
                return false;
            }
        });
        return result;
    },
    getRandomCards: function (resultCodes, weightedArray, max) {
        for (m = 0; m < max; m++) {
            if (weightedArray.length === 0) {
                return resultCodes;
            }
            var randomCode = weightedArray[Math.floor(Math.random() * weightedArray.length)];
            resultCodes.push(randomCode);
            for (l = weightedArray.length - 1; l >= 0; l--) {
                if (weightedArray[l] === randomCode) {
                    weightedArray.splice(l, 1);
                }
            }
        }
        return resultCodes;
    },
    getCardPool: function (cardSets, cardPool) {
        switch (cardPool) {
            case "runner":
                return cardSets.runner;
            case "corp":
                return cardSets.corp;
            case "runner-id":
                return cardSets.ids.runner;
            case "corp-id":
                return cardSets.ids.corp;
            case "agendas":
                return cardSets.agendas;
            case "draft-id":
                return cardSets.ids.draft;
        }
    },
    weight: function (card, weightCode, faction) {
        var weight = 5;
        switch (weightCode) {
            case "influence-weights-faction-bonus":
                if (card["faction_code"] === faction) {
                    weight *= 3;
                }
            case "influence-weights":
                if (card["faction_cost"] <= 2) {
                    weight *= 3;
                }
                if ((card["faction_cost"] === 0) && card["pack_code"] === "core") {
                    weight *= 3;
                }
                return weight;
            default:
                return weight;
        }
    },
    checkFilter: function (card, filter, agendaPoints) {
        switch (filter) {
            case "core":
                if (card["pack_code"] === "core" || card["pack_code"] === "core2") {
                    return true;
                }
                return false;
            case "economy":
                try {
                    if ((!!card["keywords"]) && (card["text"].search(/(ake [0-9]+\[credit\])|(ain [0-9]+\[credit\])/g) >= 0)) {
                        return true;
                    }
                } catch (error) {
                    console.log("Error matching regex!");
                }
                break;
            case "console":
            case "fracter":
            case "decoder":
            case "killer":
            case "icebreaker":
            case "barrier":
            case "codegate":
            case "sentry" :
            case "AI" :
                keyword = filter[0].toUpperCase() + filter.substring(1);
                try {
                    if ((!!card["keywords"]) && (card["keywords"].search(keyword) >= 0)) {
                        return true;
                    }
                } catch (error) {
                    console.log("Error matching regex!");
                }
                return false;
                break;
            case "agendas":
                if (card["agenda_points"] === agendaPoints) {
                    return true;
                }
                return false;
            case "unique":
                if (card["uniqueness"] === true) {
                    return true;
                }
                return false;
            case "hardware":
            case "ice":
            case "program":
                if (card["type_code"] === filter) {
                    return true;
                }
                return false;
            case "runner":
            case "corp":
                if (card["side_code"] === filter) {
                    return true;
                }
                return false;
            default:
                console.log("Error: " + filter + " not found");
                return false;
        }
    }
};
var onPacksDataAvaliable = function (data) {
    releasedSets = [];
    $.each(data.data, function (key, value) {
        if (value.date_release !== null) {
            if (new Date(value.date_release).getTime() <= new Date()) {
                releasedSets.push(value.code);
            }
        }
    });
    dataAccess.LoadCards(dataAccess, onDataAvaliable);
};
var onDataAvaliable = function (data) {
    var onPrebuiltsDataAvailable = function (prebuiltsData) {
        var allCards = data.data;

        for (var prebuilt of prebuiltsData.data) {
          for (var cardCode in prebuilt.cards) {
            var card = allCards.find(c => c.code === cardCode);
            card = jQuery.extend(true, {}, card); // clone the card object
            card.pack_code = prebuilt.code;
            card.quantity = prebuilt.cards[cardCode];
            allCards.push(card);
          }
        }

        myCardCollection = new CardCollection(allCards, preferences.setFilter);
        imageURLTemplate = data.imageUrlTemplate;
        myArenaScript.start();
        removeCards();
    };

    dataAccess.LoadPrebuilts(dataAccess, onPrebuiltsDataAvailable);
};
$(document).ready(function () {
    views.deckAreaContent('home');
    views.selectType();
    printHelpOnBlocking();
});



// Mostly custom stuff below

function blockDeckOrDecklist(url) {
    const decklistRE = new RegExp("netrunnerdb.com/[a-z]{2}/decklist/([0-9]+)");
    const deckRE = new RegExp("netrunnerdb.com/[a-z]{2}/deck/(?:view|edit)/([0-9]+)");
    let match;

    match = decklistRE.exec(url);
    if (match) {
        return blockDecklist(match[1]);
    }

    match = deckRE.exec(url);
    if (match) {
        return blockDeck(match[1]);
    }
}

async function fetchDecklist(id) {
    const response = await $.getJSON(`https://netrunnerdb.com/api/2.0/public/decklist/${id}`);
    return response.data[0];
}

async function fetchDeck(id) {
    const response = await $.getJSON(`https://netrunnerdb.com/api/2.0/public/deck/${id}`);
    return response.data[0];
}

async function blockDecklist(id) {
    if (!/^[0-9]+$/.test(id)) {
        return blockDeckOrDecklist(id);
    }
    const decklist = await fetchDecklist(id);
    console.log(`Blocking ${Object.values(decklist.cards).reduce((a, b) => a + b)} cards from decklist ${decklist.name}`);
    blockCards(decklist.cards);
}

async function blockDeck(id) {
    if (!/^[0-9]+$/.test(id)) {
        return blockDeckOrDecklist(id);
    }
    const deck = await fetchDeck(id);
    console.log(`Blocking ${Object.values(deck.cards).reduce((a, b) => a + b)} cards from deck ${deck.name}`);
    blockCards(deck.cards);
}

function blockCards(cards) {
    for (const cardCode in cards) {
        for (let i = 0; i < cards[cardCode]; i++) {
            if (myCardCollection !== null) {
                myCardCollection.removeCopyFromSomewhereInCollection(cardCode);
            } else {
                cardsToBeRemoved.push(cardCode);
            }
        }
    }
}

function removeCards() {
    for (const cardCode of cardsToBeRemoved) {
        myCardCollection.removeCopyFromSomewhereInCollection(cardCode);
    }
}

function printHelpOnBlocking() {
    console.log(`Hi!
You can now remove the cards contained within a deck or a decklist by calling
blockDeck(id) or blockDecklist(id) respectively, where id is the numerical ID
you can see in URLs pointing to the deck. You can also call either of the functions
with the URL of a deck or decklist directly.

For example:
    blockDecklist("https://netrunnerdb.com/en/decklist/3106/starter-deck-corp-beginner-weyland-") works the same as blockDeckList(3106)
and blockDeck("https://netrunnerdb.com/en/deck/view/1041890") is the same as blockDeck(1041890).

Actually, you can call either function with either kind of URL, so don't worry
too much about which one you use.

Cheers!`);
}

function cardImageURL(card) {
    if (card.image_url !== undefined) {
        return card.image_url;
    } else {
        return imageURLTemplate.replace("{code}", card.code);
    }
}
