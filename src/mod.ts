import { DependencyContainer } from "tsyringe";

import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IDatabaseTables } from "@spt-aki/models/spt/server/IDatabaseTables";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { BaseClasses } from "@spt-aki/models/enums/BaseClasses";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { IStaticLootDetails, ItemDistribution } from "@spt-aki/models/eft/common/tables/ILootBase";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";

const modName = "Hello, keys!";

const jacketId = "578f8778245977358849a9b5";
const sportsBagId = "578f87a3245977356274f2cb";
const deadScavId = "5909e4b686f7747f5b744fa4";

type Config = {
    blacklist: string[];
    overrides: Record<string, number>;
};

class HelloKeys implements IPostDBLoadMod {
    private logger: ILogger;

    private config: Config = require("../config/config.json");

    public postDBLoad(container: DependencyContainer): void {
        this.logger = container.resolve<ILogger>("WinstonLogger");
        this.logger.logWithColor(`[${modName}] Distributing keys around Tarkov...`, LogTextColor.YELLOW);

        const db = container.resolve<DatabaseServer>("DatabaseServer");
        const tables: IDatabaseTables = db.getTables();
        const items = tables.templates.items;
        const fleaPrices = tables.templates.prices;
        const itemHelper = container.resolve<ItemHelper>("ItemHelper");

        const keys: string[] = [];
        let maxFleaPrice = 0;


        // Find all the keys, and the most expensive
        for (const itemId in items) {
            // Ignore items that are blacklisted
            if (this.config.blacklist.includes(itemId)) {
                continue;
            }

            const item = items[itemId];
            if (item._type == "Item") {
                if (itemHelper.isOfBaseclass(itemId, BaseClasses.KEY_MECHANICAL)) {
                    const fleaPrice = fleaPrices[itemId];
                    if (!fleaPrice) {
                        // this.logger.warning(`[${modName}] No flea price for ${itemId}`);
                        continue;
                    }

                    // this.logger.info(`[${modName}] found mechanical key: ${itemId}: ${fleaPrice}`);
                    keys.push(itemId);
                    if (fleaPrice > maxFleaPrice) {
                        maxFleaPrice = fleaPrice;
                    }
                }
            }
        }

        // Generate a distribution with the most expensive/rarest as 1
        // These are still fractional! Must be normalized to each container and rounded to integers
        const rawKeyDistribution = keys.map<ItemDistribution>((keyId) => ({
            tpl: keyId,
            relativeProbability: maxFleaPrice / fleaPrices[keyId]
        }));

        // Manually handle these non-flea keys
        for (const itemId in this.config.overrides) {
            // this.logger.info(`[${modName}] Overriding distribution for ${itemHelper.getItemName(itemId)}`);
            rawKeyDistribution.push({
                tpl: itemId,
                relativeProbability: this.config.overrides[itemId]
            });
        }

        const jacket = tables.loot.staticLoot[jacketId];
        const sportsBag = tables.loot.staticLoot[sportsBagId];
        const deadScav = tables.loot.staticLoot[deadScavId];

        this.updateDistribution(jacket, rawKeyDistribution);
        this.updateDistribution(sportsBag, rawKeyDistribution);
        this.updateDistribution(deadScav, rawKeyDistribution);

        // Update jackets to sometimes drop 2 items half the time
        const singleProbability = jacket.itemcountDistribution.find((d) => d.count === 1);
        jacket.itemcountDistribution.push({
            count: 2,
            relativeProbability: singleProbability.relativeProbability
        });
    }

    // Project the raw key distribution onto the top half of the container's distribution
    private updateDistribution(container: IStaticLootDetails, rawKeyDistribution: ItemDistribution[]) {
        // Find the median probability in the container
        const sortedValues = container.itemDistribution.map((item) => item.relativeProbability).sort((a, b) => a - b);
        const medianProbability = sortedValues[Math.floor(sortedValues.length / 2)];
        const maxProbability = sortedValues[sortedValues.length - 1];

        // Also need the max of the key distribution
        let maxKeyProbability = 0;
        rawKeyDistribution.forEach((item) => {
            if (item.relativeProbability > maxKeyProbability) {
                maxKeyProbability = item.relativeProbability;
            }
        });

        // Calculate how to scale the key distribution to the container distribution
        const scale = (maxProbability - medianProbability) / maxKeyProbability;

        // For each probability, multiply by scale and add the average. Since the key distribution starts at 1 it simplifies the math
        const normalizedKeyDistribution = rawKeyDistribution.map<ItemDistribution>((item) => ({
            tpl: item.tpl,
            relativeProbability: Math.ceil(item.relativeProbability * scale + medianProbability)
        }));

        // Update keys and add missing ones with the normalized distribution data
        //for (const item of normalizedKeyDistribution) {
        normalizedKeyDistribution.forEach((item) => {
            const foundItem = container.itemDistribution.find((d) => d.tpl === item.tpl);
            if (foundItem) {
                foundItem.relativeProbability = item.relativeProbability;
            } else {
                container.itemDistribution.push({
                    tpl: item.tpl,
                    relativeProbability: item.relativeProbability
                });
            }
        });
    }
}

module.exports = { mod: new HelloKeys() };
