import re
from typing import Optional


def normalize_phone(phone: str) -> str:
    """
    Normalizes an Indian phone number to canonical international format (+91XXXXXXXXXX).
    
    Accepts:
        - 10-digit mobile numbers: "9876543210" -> "+919876543210"
        - Formatted numbers: "+91 9876543210", "+91-98765-43210", "(+91) 9876543210"
        - Numbers with leading zero: "09876543210"
        - Numbers with 91 prefix: "919876543210"
    
    Returns:
        Canonical format: "+91XXXXXXXXXX"
    
    Raises:
        ValueError: If the phone number is invalid or cannot be normalized.
    """
    if not phone or not isinstance(phone, str):
        raise ValueError("Phone number is required.")

    # Remove all non-digit characters except leading plus if present
    stripped = phone.strip()
    digits_only = re.sub(r"\D", "", stripped)

    if not digits_only:
        raise ValueError("Please enter a valid 10-digit mobile number.")

    # Determine the 10-digit national number
    if len(digits_only) == 10:
        national_number = digits_only
    elif len(digits_only) == 11 and digits_only.startswith("0"):
        national_number = digits_only[1:]
    elif len(digits_only) == 12 and digits_only.startswith("91"):
        national_number = digits_only[2:]
    else:
        raise ValueError("Please enter a valid 10-digit mobile number.")

    # Indian mobile numbers start with 6, 7, 8, or 9
    if not re.match(r"^[6-9]\d{9}$", national_number):
        raise ValueError("Please enter a valid 10-digit mobile number.")

    return f"+91{national_number}"


def is_valid_phone(phone: str) -> bool:
    """
    Returns True if the phone number can be normalized to a valid Indian mobile number, False otherwise.
    """
    try:
        normalize_phone(phone)
        return True
    except (ValueError, TypeError):
        return False
