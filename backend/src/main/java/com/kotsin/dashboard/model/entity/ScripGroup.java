package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "ScripGroup")
public class ScripGroup {

    @Id
    private String id; // scripCode

    private String companyName;
    private EquityInfo equity;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EquityInfo {
        private String ScripCode;
        private String Name;
        private String FullName;
        private String SymbolRoot;
        private String ISIN;
    }
}
