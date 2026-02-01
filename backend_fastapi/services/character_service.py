"""
Character Management Service.
Implements CharacterCardParser (V2 Spec) and CharacterManager for persona state.
"""

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from backend_fastapi.utils.logger import get_logger

logger = get_logger("character_service")


@dataclass
class ParsedCharacter:
    """Parsed character data from a character card."""
    name: str
    description: str
    personality: str
    scenario: str
    first_message: str
    system_prompt: str
    post_history_instructions: str
    example_messages: list[dict[str, str]]
    alternate_greetings: list[str]
    tags: list[str]
    creator: str
    character_version: str
    creator_notes: str
    extensions: dict[str, Any]
    character_book: Optional[dict[str, Any]]
    raw: dict[str, Any]
    parsed_at: str = field(default_factory=lambda: datetime.now().isoformat())


class CharacterCardParser:
    """
    Parser for Chub AI Character Card V2 format.
    Specifically handles V2 Spec fields: system_prompt, post_history_instructions, first_mes.
    """
    
    @staticmethod
    def parse(character_data: dict[str, Any]) -> ParsedCharacter:
        """
        Parse character card from JSON data.
        
        Args:
            character_data: Raw character card data (V2 spec)
            
        Returns:
            ParsedCharacter object
            
        Raises:
            ValueError: If card format is invalid
        """
        # Validate format
        spec = character_data.get("spec", "")
        if spec != "chara_card_v2":
            raise ValueError(f'Invalid character card format. Expected "chara_card_v2", got "{spec}"')
        
        spec_version = character_data.get("spec_version", "")
        if spec_version != "2.0":
            logger.warning(f"Unexpected spec_version: {spec_version}. Expected '2.0'")
        
        data = character_data.get("data", {})
        
        # Validate required fields
        required_fields = ["name", "description", "personality", "first_mes"]
        for field_name in required_fields:
            if not data.get(field_name):
                raise ValueError(f"Missing required field: {field_name}")
        
        # Generate system prompt from character data
        system_prompt = CharacterCardParser._generate_system_prompt(data)
        
        return ParsedCharacter(
            name=data["name"],
            description=data["description"],
            personality=data["personality"],
            scenario=data.get("scenario", ""),
            first_message=data["first_mes"],
            system_prompt=system_prompt,
            post_history_instructions=data.get("post_history_instructions", ""),
            example_messages=CharacterCardParser._parse_example_messages(data.get("mes_example", "")),
            alternate_greetings=data.get("alternate_greetings", []),
            tags=data.get("tags", []),
            creator=data.get("creator", "Unknown"),
            character_version=data.get("character_version", "1.0"),
            creator_notes=data.get("creator_notes", ""),
            extensions=data.get("extensions", {}),
            character_book=data.get("character_book"),
            raw=data
        )
    
    @staticmethod
    def _generate_system_prompt(data: dict[str, Any]) -> str:
        """
        Generate system prompt from character data.
        Handles V2 Spec system_prompt field with {{original}} placeholder.
        
        Args:
            data: Character data object
            
        Returns:
            Generated system prompt
        """
        char_name = data["name"]
        
        # Build base prompt
        prompt_parts = [f"You are {char_name}.\n"]
        
        # Add personality
        if data.get("personality"):
            prompt_parts.append(f"Personality: {data['personality']}\n")
        
        # Add description/background
        if data.get("description"):
            prompt_parts.append(f"Background: {data['description']}\n")
        
        # Add scenario
        if data.get("scenario"):
            prompt_parts.append(f"Scenario: {data['scenario']}\n")
        
        # Add example messages
        if data.get("mes_example"):
            cleaned_examples = CharacterCardParser._clean_examples(data["mes_example"], char_name)
            if cleaned_examples:
                prompt_parts.append(f"Example responses:\n{cleaned_examples}\n")
        
        base_prompt = "\n".join(prompt_parts)
        
        # Handle custom system_prompt with {{original}} placeholder
        if data.get("system_prompt"):
            custom_prompt = data["system_prompt"]
            if "{{original}}" in custom_prompt:
                prompt = custom_prompt.replace("{{original}}", base_prompt.strip())
            else:
                prompt = f"{custom_prompt}\n\n{base_prompt}"
        else:
            prompt = base_prompt
        
        # Add post-history instructions
        if data.get("post_history_instructions"):
            prompt += f"\n\nPost-history Instructions: {data['post_history_instructions']}"
        
        # Ensure character stays in character
        prompt += (
            f"\n\nIMPORTANT: Stay in character as {char_name} at all times. "
            "Never break the fourth wall or acknowledge that this is a roleplay. "
            "Maintain your personality and speech patterns consistently."
        )
        
        return prompt
    
    @staticmethod
    def _parse_example_messages(mes_example: str) -> list[dict[str, str]]:
        """
        Parse example messages from mes_example string.
        
        Args:
            mes_example: Example messages string with <START> tokens
            
        Returns:
            List of parsed example messages
        """
        if not mes_example:
            return []
        
        examples = []
        sections = mes_example.split("<START>")
        
        for section in sections:
            section = section.strip()
            if not section:
                continue
            
            user_match = re.search(r"\{\{user\}\}:\s*(.+?)(?=\n\{\{|$)", section, re.DOTALL)
            char_match = re.search(r"\{\{char\}\}:\s*(.+?)(?=\n\{\{|$)", section, re.DOTALL)
            
            if user_match and char_match:
                examples.append({
                    "user": user_match.group(1).strip(),
                    "character": char_match.group(1).strip()
                })
        
        return examples
    
    @staticmethod
    def _clean_examples(mes_example: str, char_name: str) -> str:
        """
        Clean example messages for system prompt.
        
        Args:
            mes_example: Raw example messages
            char_name: Character name for replacement
            
        Returns:
            Cleaned examples string
        """
        if not mes_example:
            return ""
        
        cleaned_parts = []
        sections = mes_example.split("<START>")
        
        for section in sections:
            section = section.strip()
            if not section:
                continue
            
            user_match = re.search(r"\{\{user\}\}:\s*(.+?)(?=\n|$)", section, re.DOTALL)
            char_match = re.search(r"\{\{char\}\}:\s*(.+?)(?=\n|$)", section, re.DOTALL)
            
            if user_match and char_match:
                cleaned_parts.append(
                    f"User: {user_match.group(1).strip()}\n"
                    f"{char_name}: {char_match.group(1).strip()}"
                )
        
        return "\n\n".join(cleaned_parts)
    
    @staticmethod
    def validate(character_data: dict[str, Any]) -> dict[str, Any]:
        """
        Validate character card format.
        
        Args:
            character_data: Character card data
            
        Returns:
            Validation result with 'valid', 'errors', 'warnings'
        """
        errors = []
        warnings = []
        
        try:
            # Check format version
            if not character_data.get("spec"):
                errors.append("Missing spec field")
            elif character_data["spec"] != "chara_card_v2":
                errors.append(f'Invalid spec: {character_data["spec"]}. Expected "chara_card_v2"')
            
            if not character_data.get("spec_version"):
                errors.append("Missing spec_version field")
            elif character_data["spec_version"] != "2.0":
                warnings.append(f'Unexpected spec_version: {character_data["spec_version"]}. Expected "2.0"')
            
            data = character_data.get("data")
            if not data:
                errors.append("Missing data field")
                return {"valid": False, "errors": errors, "warnings": warnings}
            
            # Check required fields
            required_fields = ["name", "description", "personality", "first_mes"]
            for field_name in required_fields:
                if not data.get(field_name):
                    errors.append(f"Missing required field: {field_name}")
                elif not isinstance(data[field_name], str):
                    errors.append(f"Field {field_name} must be a string")
            
            # Validate mes_example format
            if data.get("mes_example"):
                if "<START>" not in data["mes_example"]:
                    warnings.append("mes_example should use <START> tokens to separate conversations")
                if "{{user}}" not in data["mes_example"] and "{{char}}" not in data["mes_example"]:
                    warnings.append("mes_example should use {{user}} and {{char}} placeholders")
            
            # Validate character book
            if data.get("character_book"):
                book = data["character_book"]
                if not isinstance(book.get("entries"), list):
                    errors.append("character_book.entries must be an array")
                else:
                    for i, entry in enumerate(book["entries"]):
                        if not isinstance(entry.get("keys"), list):
                            errors.append(f"character_book entry {i} missing keys array")
                        if not entry.get("content"):
                            errors.append(f"character_book entry {i} missing content")
        
        except Exception as e:
            errors.append(f"Validation error: {str(e)}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    @staticmethod
    def create_basic_card(basic_info: dict[str, Any]) -> dict[str, Any]:
        """
        Create a minimal character card from basic info.
        
        Args:
            basic_info: Basic character information
            
        Returns:
            Character card data in V2 spec format
        """
        name = basic_info.get("name", "Unnamed Character")
        return {
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": {
                "name": name,
                "description": basic_info.get("description", "A mysterious character."),
                "personality": basic_info.get("personality", "Friendly and curious."),
                "scenario": basic_info.get("scenario", ""),
                "first_mes": basic_info.get("first_message", f"Hello! I'm {name}. Nice to meet you!"),
                "mes_example": basic_info.get(
                    "example_message",
                    "<START>\n{{user}}: Hello!\n{{char}}: It's a pleasure to meet you!"
                ),
                "tags": basic_info.get("tags", []),
                "creator": basic_info.get("creator", "AI Companion")
            }
        }


class CharacterManager:
    """
    Manages character persona state independently of the LLM provider.
    Handles loading, saving, and maintaining the current active character.
    """
    
    def __init__(self, characters_dir: Path | None = None):
        """
        Initialize the CharacterManager.
        
        Args:
            characters_dir: Directory to store character files
        """
        if characters_dir is None:
            characters_dir = Path(__file__).parent.parent.parent / "backend" / "data" / "characters"
        
        self.characters_dir = characters_dir
        self.characters_dir.mkdir(parents=True, exist_ok=True)
        
        self._active_character: ParsedCharacter | None = None
        self._active_character_id: str | None = None
    
    @property
    def active_character(self) -> ParsedCharacter | None:
        """Get the currently active character."""
        return self._active_character
    
    @property
    def active_character_id(self) -> str | None:
        """Get the ID of the currently active character."""
        return self._active_character_id
    
    def get_system_prompt(self) -> str:
        """Get the system prompt for the active character."""
        if self._active_character:
            return self._active_character.system_prompt
        return "You are a helpful AI assistant."
    
    def get_first_message(self) -> str | None:
        """Get the first message for the active character."""
        if self._active_character:
            return self._active_character.first_message
        return None
    
    def get_post_history_instructions(self) -> str:
        """Get post-history instructions for the active character."""
        if self._active_character:
            return self._active_character.post_history_instructions
        return ""
    
    async def load_character(self, character_id: str) -> ParsedCharacter:
        """
        Load a character by ID and set it as active.
        
        Args:
            character_id: UUID of the character to load
            
        Returns:
            Loaded ParsedCharacter
            
        Raises:
            FileNotFoundError: If character not found
            ValueError: If character data is invalid
        """
        character_path = self.characters_dir / f"{character_id}.json"
        
        if not character_path.exists():
            raise FileNotFoundError(f"Character not found: {character_id}")
        
        with open(character_path, "r", encoding="utf-8") as f:
            character_record = json.load(f)
        
        # Parse the character data
        parsed = CharacterCardParser.parse({
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": character_record.get("data", {}).get("data", character_record.get("data", {}))
        })
        
        self._active_character = parsed
        self._active_character_id = character_id
        
        logger.info(f"Loaded character: {parsed.name} ({character_id})")
        return parsed
    
    async def save_character(
        self,
        character_data: dict[str, Any],
        character_id: str | None = None,
        created_by: str = "unknown"
    ) -> str:
        """
        Save a character to storage.
        
        Args:
            character_data: Raw character card data
            character_id: Optional ID (generates new if not provided)
            created_by: Username of creator
            
        Returns:
            Character ID
        """
        # Validate
        validation = CharacterCardParser.validate(character_data)
        if not validation["valid"]:
            raise ValueError(f"Invalid character data: {validation['errors']}")
        
        # Parse
        parsed = CharacterCardParser.parse(character_data)
        
        # Generate ID if needed
        if character_id is None:
            character_id = str(uuid.uuid4())
        
        # Create record
        character_record = {
            "id": character_id,
            "name": parsed.name,
            "data": character_data,
            "parsed": {
                "name": parsed.name,
                "description": parsed.description,
                "personality": parsed.personality,
                "first_message": parsed.first_message,
                "system_prompt": parsed.system_prompt
            },
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "created_by": created_by
        }
        
        # Save
        character_path = self.characters_dir / f"{character_id}.json"
        with open(character_path, "w", encoding="utf-8") as f:
            json.dump(character_record, f, indent=2)
        
        logger.info(f"Saved character: {parsed.name} ({character_id})")
        return character_id
    
    async def list_characters(self) -> list[dict[str, Any]]:
        """
        List all available characters.
        
        Returns:
            List of character summaries
        """
        characters = []
        
        for file_path in self.characters_dir.glob("*.json"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    record = json.load(f)
                
                characters.append({
                    "id": record.get("id"),
                    "name": record.get("name"),
                    "description": record.get("parsed", {}).get("description", "")[:100],
                    "created_at": record.get("created_at"),
                    "updated_at": record.get("updated_at")
                })
            except Exception as e:
                logger.warning(f"Error reading character file {file_path}: {e}")
        
        # Sort by updated date
        characters.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return characters
    
    async def delete_character(self, character_id: str) -> bool:
        """
        Delete a character by ID.
        
        Args:
            character_id: UUID of the character to delete
            
        Returns:
            True if deleted, False if not found
        """
        character_path = self.characters_dir / f"{character_id}.json"
        
        if not character_path.exists():
            return False
        
        character_path.unlink()
        
        # Clear active if this was the active character
        if self._active_character_id == character_id:
            self._active_character = None
            self._active_character_id = None
        
        logger.info(f"Deleted character: {character_id}")
        return True
    
    def clear_active(self):
        """Clear the active character."""
        self._active_character = None
        self._active_character_id = None


# Singleton instance
_character_manager: CharacterManager | None = None


def get_character_manager() -> CharacterManager:
    """Get or create CharacterManager instance."""
    global _character_manager
    if _character_manager is None:
        _character_manager = CharacterManager()
    return _character_manager
