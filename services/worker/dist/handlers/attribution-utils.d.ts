type ConvertedLead = {
    id: string;
    convertedAt: Date | null;
};
export declare const computeLeadAttribution: (organizationId: string, convertedLeads: ConvertedLead[], lookbackDays: number) => Promise<void>;
export {};
//# sourceMappingURL=attribution-utils.d.ts.map