import { db } from "../shared/firebase.js";
import { createOrderId } from "../shared/system.js";
import { 
    collection, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// المتغيرات العامة
let storeSettings = { psRate: 200, xboxRate: 200, pcRate: 100, psMin: 100000, psMax: 5000000, pcMin: 100000, pcMax: 1000000 };
let selectedPlatform = null; 
let currentPaymentCategory = null; 
let selectedPaymentMethod = '';
let currentRate = 200;
let minLimit = 100000;
let maxLimit = 5000000;
let currentQty = 0; 
let generatedOrderId = "";
let isEditingAll = false;
const supportWhatsappNumber = "966570770465";

function convertArabicNumbersToEnglish(inputElement) {
    if (!inputElement) return;
    const arabicNumbers = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
    let val = inputElement.value;
    for (let i = 0; i < 10; i++) {
        val = val.replace(arabicNumbers[i], i);
    }
    inputElement.value = val.replace(/[^0-9]/g, '');
}

function selectPlatform(platform) {
    selectedPlatform = platform;
    document.querySelectorAll('.platform-btn').forEach(btn => btn.classList.remove('active'));
    
    if (platform === 'PlayStation') document.querySelectorAll('.ps-btn').forEach(b => b.classList.add('active'));
    else if (platform === 'Xbox') document.querySelectorAll('.xbox-btn').forEach(b => b.classList.add('active'));
    else if (platform === 'PC') document.querySelectorAll('.pc-btn').forEach(b => b.classList.add('active'));

    if (platform === 'PC') {
        currentRate = storeSettings.pcRate;
        minLimit = storeSettings.pcMin;
        maxLimit = storeSettings.pcMax;
    } else if (platform === 'Xbox') {
        currentRate = storeSettings.xboxRate;
        minLimit = storeSettings.psMin;
        maxLimit = storeSettings.psMax;
    } else {
        currentRate = storeSettings.psRate;
        minLimit = storeSettings.psMin;
        maxLimit = storeSettings.psMax;
    }

    document.getElementById('platformPromptBox')?.classList.add('hidden');
    document.getElementById('singlePlatformRateCard')?.classList.remove('hidden');
    document.getElementById('durationInfoCardsStep1')?.classList.remove('hidden');
    document.getElementById('qtyCardContainer')?.classList.remove('hidden');
    document.getElementById('totalAmountBoxCard')?.classList.remove('hidden');
    document.getElementById('paymentCategoryCard')?.classList.remove('hidden');
    document.getElementById('payoutCardContainer')?.classList.remove('hidden');

    const minTextEl = document.getElementById('minLimitText');
    const maxTextEl = document.getElementById('maxLimitText');
    if (minTextEl) minTextEl.innerText = minLimit.toLocaleString('en-US');
    if (maxTextEl) maxTextEl.innerText = maxLimit.toLocaleString('en-US');

    const range = document.getElementById('qtyRange');
    if (range) {
        range.min = 0; 
        range.max = maxLimit;
        range.value = currentQty;
    }

    const qtyInput = document.getElementById('quantityInput');
    if (qtyInput) {
        qtyInput.value = currentQty > 0 ? currentQty.toLocaleString('en-US') : '';
    }

    updateRateCardsUI();
    calculateTotal();
}

function updateRateCardsUI() {
    if (!selectedPlatform) return;
    const rateValEl = document.getElementById("displaySelectedRate");
    const platIconEl = document.getElementById("selectedPlatformIcon");

    if (rateValEl) rateValEl.innerText = currentRate;
    if (platIconEl) {
        if (selectedPlatform === 'PlayStation') platIconEl.className = "fa-brands fa-playstation";
        else if (selectedPlatform === 'Xbox') platIconEl.className = "fa-brands fa-xbox";
        else if (selectedPlatform === 'PC') platIconEl.className = "fa-solid fa-desktop";
    }
}

function switchPaymentCategory(category) {
    currentPaymentCategory = category;
    const tabLocal = document.getElementById('tabLocal');
    const tabIntl = document.getElementById('tabIntl');

    if (tabLocal) {
        tabLocal.classList.toggle('active', category === 'local');
        tabLocal.style.borderColor = 'var(--border-color)';
    }
    if (tabIntl) {
        tabIntl.classList.toggle('active', category === 'international');
        tabIntl.style.borderColor = 'var(--border-color)';
    }

    selectedPaymentMethod = (category === 'local') ? 'تحويل بنكي' : 'USDT';
    
    const payGridContainer = document.getElementById('dynamicPaymentMethodsGrid');
    payGridContainer?.classList.remove('hidden');

    updateDynamicUI();
    selectPaymentMethod(selectedPaymentMethod);
}

function updateDynamicUI() {
    const payGridContainer = document.getElementById('dynamicPaymentMethodsGrid');
    if (!payGridContainer) return;
    payGridContainer.innerHTML = '';
    let filteredMethods = (currentPaymentCategory === 'local') ? ["تحويل بنكي", "المحافظ الرقمية"] : ["USDT", "PayPal", "Western Union"];

    filteredMethods.forEach((method) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `pay-btn-compact ${selectedPaymentMethod === method ? 'active' : ''}`;
        btn.onclick = () => selectPaymentMethod(method);
        let iconClass = 'fa-solid fa-wallet';
        if (method === 'تحويل بنكي') iconClass = 'fa-solid fa-building-columns';
        else if (method === 'المحافظ الرقمية') iconClass = 'fa-solid fa-mobile-screen-button';
        else if (method === 'USDT') iconClass = 'fa-solid fa-coins';
        else if (method === 'PayPal') iconClass = 'fa-brands fa-paypal';
        else if (method === 'Western Union') iconClass = 'fa-solid fa-globe';

        btn.innerHTML = `<i class="${iconClass}"></i> ${method}`;
        payGridContainer.appendChild(btn);
    });
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    updateDynamicUI();
    calculateTotal();
}

function adjustQty(amount) {
    if (!selectedPlatform) selectPlatform('PlayStation');
    currentQty += amount;
    if (currentQty < 0) currentQty = 0;
    const qtyInput = document.getElementById('quantityInput');
    if (qtyInput) {
        qtyInput.value = currentQty > 0 ? currentQty.toLocaleString('en-US') : '';
        qtyInput.style.borderColor = 'var(--border-color)';
    }
    const range = document.getElementById('qtyRange');
    if (range) range.value = currentQty;
    calculateTotal();
}

function formatAndCalculate(input) {
    if (!selectedPlatform) selectPlatform('PlayStation');
    let val = input.value.replace(/[^0-9]/g, '');
    currentQty = val === '' ? 0 : parseInt(val, 10);
    input.value = currentQty > 0 ? currentQty.toLocaleString('en-US') : '';
    input.style.borderColor = 'var(--border-color)';
    const range = document.getElementById('qtyRange');
    if (range) range.value = currentQty;
    calculateTotal();
}

function sliderChanged(slider) {
    if (!selectedPlatform) selectPlatform('PlayStation');
    currentQty = parseInt(slider.value, 10);
    const qtyInput = document.getElementById('quantityInput');
    if (qtyInput) {
        qtyInput.value = currentQty > 0 ? currentQty.toLocaleString('en-US') : '';
        qtyInput.style.borderColor = 'var(--border-color)';
    }
    calculateTotal();
}

function calculateTotal() {
    if (!selectedPlatform) return;
    const totalEl = document.getElementById('totalAmountText');
    if (!totalEl) return;
    const millions = currentQty / 1000000;
    let totalSar = millions * currentRate;

    const isDollar = (currentPaymentCategory === 'international');
    if (isDollar) {
        let totalUsd = totalSar / 3.75;
        totalEl.innerHTML = `$${totalUsd.toFixed(2)}`;
    } else {
        totalEl.innerHTML = `${totalSar.toFixed(2)} ر.س`;
    }
}

function renderStep2PaymentFields() {
    const container = document.getElementById('step2PaymentFieldsContainer');
    if (!container) return;
    
    if (selectedPaymentMethod === 'تحويل بنكي') {
        container.innerHTML = `
            <label class="field-label">اسم البنك المحول إليه <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap">
                <select id="bankNameSelect" required>
                    <option value="الراجحي">الراجحي</option>
                    <option value="الأهلي السعودي">الأهلي السعودي</option>
                    <option value="الإنماء">الإنماء</option>
                    <option value="البلاد">البلاد</option>
                    <option value="الرياض">الرياض</option>
                </select>
            </div>
            <label class="field-label">الاسم الكامل للحساب البنكي <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="text" id="bankFullName" placeholder="الاسم كما في الحساب البنكي"></div>
            <label class="field-label">رقم الإيبان (IBAN) <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="text" id="bankIban" placeholder="SA0000000000000000000000"></div>
        `;
    } else if (selectedPaymentMethod === 'المحافظ الرقمية') {
        container.innerHTML = `
            <label class="field-label">اسم المحفظة الرقمية <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><select id="walletNameSelect" required><option value="STC Pay">STC Pay</option><option value="Urpay">Urpay</option></select></div>
            <label class="field-label">رقم الجوال المرتبط بالمحفظة <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="tel" id="walletPhone" placeholder="9665xxxxxxxx" oninput="convertArabicNumbersToEnglish(this)"></div>
        `;
    } else if (selectedPaymentMethod === 'USDT') {
        container.innerHTML = `
            <label class="field-label">عنوان المحفظة (USDT TRC20) <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="text" id="usdtAddress" placeholder="أدخل عنوان محفظة USDT الخاص بك"></div>
        `;
    } else if (selectedPaymentMethod === 'PayPal') {
        container.innerHTML = `
            <label class="field-label">بريد PayPal الإلكتروني <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="email" id="paypalEmail" placeholder="example@domain.com"></div>
        `;
    } else {
        container.innerHTML = `
            <label class="field-label">الاسم الكامل بالإنجليزية حسب الهوية <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="text" id="wuName" placeholder="Full Name in English"></div>
            <label class="field-label">الدولة <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="text" id="wuCountry" placeholder="مثال: Saudi Arabia"></div>
            <label class="field-label">العملة <span style="color:#ef4444">*</span>:</label>
            <div class="input-box-wrap"><input type="text" id="wuCurrency" placeholder="مثال: USD"></div>
        `;
    }
}

function showScreen(screenId) {
    ['step1Screen', 'step2Screen', 'step3ReviewScreen', 'step4SuccessScreen'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });
    document.getElementById(screenId)?.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToStep2() {
    if (!selectedPlatform) {
        document.querySelector('.platforms-flex')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if (!currentPaymentCategory) {
        const payBox = document.getElementById('paymentCategoryCard');
        if (payBox) {
            payBox.style.borderColor = '#ef4444';
            payBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    if (currentQty < minLimit || currentQty > maxLimit) {
        const qtyWrap = document.getElementById('quantityInput');
        if (qtyWrap) {
            qtyWrap.style.borderColor = '#ef4444';
            qtyWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    renderStep2PaymentFields();
    showScreen('step2Screen');
}

function buildPaymentDetailsHTML() {
    let html = '';
    if (selectedPaymentMethod === 'تحويل بنكي') {
        const bank = document.getElementById('bankNameSelect')?.value || 'الراجحي';
        const name = document.getElementById('bankFullName')?.value.trim() || '';
        const iban = document.getElementById('bankIban')?.value.trim() || '';
        html = `<div class="field-label">طريقة التحويل:</div><div class="review-value-box"><span>تحويل بنكي (${bank})</span></div><div class="field-label">اسم الحساب والإيبان:</div><div class="review-value-box"><span>${name} - ${iban}</span></div>`;
    } else if (selectedPaymentMethod === 'المحافظ الرقمية') {
        const wallet = document.getElementById('walletNameSelect')?.value || 'STC Pay';
        const phone = document.getElementById('walletPhone')?.value.trim() || '';
        html = `<div class="field-label">طريقة التحويل:</div><div class="review-value-box"><span>${wallet} (${phone})</span></div>`;
    } else if (selectedPaymentMethod === 'USDT') {
        const addr = document.getElementById('usdtAddress')?.value.trim() || '';
        html = `<div class="field-label">طريقة التحويل:</div><div class="review-value-box"><span>USDT: ${addr}</span></div>`;
    } else {
        html = `<div class="field-label">طريقة التحويل:</div><div class="review-value-box"><span>${selectedPaymentMethod}</span></div>`;
    }
    return html;
}

function goToReview() {
    const nameInput = document.getElementById('customerName');
    const phoneInput = document.getElementById('customerPhone');
    const emailInput = document.getElementById('eaEmail');
    const passInput = document.getElementById('eaPass');
    const c1Input = document.getElementById('code1');
    const c2Input = document.getElementById('code2');
    const c3Input = document.getElementById('code3');

    [nameInput, phoneInput, emailInput, passInput, c1Input, c2Input, c3Input].forEach(el => {
        if(el) el.style.borderColor = 'var(--border-color)';
    });

    if (!nameInput || !nameInput.value.trim()) {
        if(nameInput) {
            nameInput.style.borderColor = '#ef4444';
            nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    if (!phoneInput || !phoneInput.value.trim()) {
        if(phoneInput) {
            phoneInput.style.borderColor = '#ef4444';
            phoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    if (!emailInput || !emailInput.value.trim()) {
        if(emailInput) {
            emailInput.style.borderColor = '#ef4444';
            emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    const pass = passInput ? passInput.value.trim() : '';
    const hasUpperCase = /[A-Z]/.test(pass);
    if (!hasUpperCase) {
        if(passInput) {
            passInput.style.borderColor = '#ef4444';
            passInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    if (!c1Input || !c1Input.value.trim()) {
        if(c1Input) {
            c1Input.style.borderColor = '#ef4444';
            c1Input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    if (!c2Input || !c2Input.value.trim()) {
        if(c2Input) {
            c2Input.style.borderColor = '#ef4444';
            c2Input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }
    if (!c3Input || !c3Input.value.trim()) {
        if(c3Input) {
            c3Input.style.borderColor = '#ef4444';
            c3Input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    const dynamicFields = document.querySelectorAll('#step2PaymentFieldsContainer input');
    for (let field of dynamicFields) {
        if (!field.value.trim()) {
            field.style.borderColor = '#ef4444';
            field.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    }

    const name = nameInput.value.trim();
    const phoneVal = phoneInput.value.trim();
    const email = emailInput.value.trim();
    const c1 = c1Input.value.trim();
    const c2 = c2Input.value.trim();
    const c3 = c3Input.value.trim();

    const platBox = document.getElementById('revPlatformBoxTheme');
    const revIcon = document.getElementById('revPlatformIcon');
    if(platBox && revIcon) {
        platBox.className = "review-styled-box";
        if (selectedPlatform === 'PlayStation') { platBox.classList.add('ps-theme'); revIcon.className = "fa-brands fa-playstation"; }
        else if (selectedPlatform === 'Xbox') { platBox.classList.add('xbox-theme'); revIcon.className = "fa-brands fa-xbox"; }
        else if (selectedPlatform === 'PC') { platBox.classList.add('pc-theme'); revIcon.className = "fa-solid fa-desktop"; }
    }

    const revQtyEl = document.getElementById('revQty');
    const revTotalEl = document.getElementById('revTotal');
    const revEmailEl = document.getElementById('revEmail');
    const revPassEl = document.getElementById('revPass');
    const revCodesEl = document.getElementById('revCodes');
    const revClientNameEl = document.getElementById('revClientName');
    const revClientPhoneEl = document.getElementById('revClientPhone');

    if(revQtyEl) revQtyEl.innerText = currentQty.toLocaleString('en-US');
    if(revTotalEl) revTotalEl.innerText = document.getElementById('totalAmountText')?.innerText || '';
    if(revEmailEl) revEmailEl.innerText = email;
    if(revPassEl) revPassEl.innerText = pass;
    if(revCodesEl) revCodesEl.innerHTML = `<div class="backup-codes-stack"><div class="code-display-row"><span class="code-number-tag">#1</span> <span>${c1}</span></div><div class="code-display-row"><span class="code-number-tag">#2</span> <span>${c2}</span></div><div class="code-display-row"><span class="code-number-tag">#3</span> <span>${c3}</span></div></div>`;
    if(revClientNameEl) revClientNameEl.innerText = name;
    if(revClientPhoneEl) revClientPhoneEl.innerText = phoneVal;
    
    const revSpecDetails = document.getElementById('revSpecificDetailsContainer');
    if(revSpecDetails) revSpecDetails.innerHTML = buildPaymentDetailsHTML();

    const editEaEmailEl = document.getElementById('editEaEmail');
    const editEaPassEl = document.getElementById('editEaPass');
    const editCode1El = document.getElementById('editCode1');
    const editCode2El = document.getElementById('editCode2');
    const editCode3El = document.getElementById('editCode3');
    const editClientNameEl = document.getElementById('editClientName');
    const editClientPhoneEl = document.getElementById('editClientPhone');
    const inlineQtyInputEl = document.getElementById('inlineQtyInput');

    if(editEaEmailEl) editEaEmailEl.value = email;
    if(editEaPassEl) editEaPassEl.value = pass;
    if(editCode1El) editCode1El.value = c1;
    if(editCode2El) editCode2El.value = c2;
    if(editCode3El) editCode3El.value = c3;
    if(editClientNameEl) editClientNameEl.value = name;
    if(editClientPhoneEl) editClientPhoneEl.value = phoneVal;
    if(inlineQtyInputEl) inlineQtyInputEl.value = currentQty.toLocaleString('en-US');

    const payoutWrap = document.getElementById('inlinePayoutEditWrap');
    if (payoutWrap) {
        if (selectedPaymentMethod === 'تحويل بنكي') {
            payoutWrap.innerHTML = `
                <label class="field-label">اسم البنك:</label><div class="input-box-wrap"><input type="text" id="editBankName" value="${document.getElementById('bankNameSelect')?.value || ''}"></div>
                <label class="field-label">الاسم:</label><div class="input-box-wrap"><input type="text" id="editBankFullName" value="${document.getElementById('bankFullName')?.value || ''}"></div>
                <label class="field-label">الإيبان:</label><div class="input-box-wrap"><input type="text" id="editBankIban" value="${document.getElementById('bankIban')?.value || ''}"></div>
            `;
        } else if (selectedPaymentMethod === 'المحافظ الرقمية') {
            payoutWrap.innerHTML = `
                <label class="field-label">رقم الجوال للمحفظة:</label><div class="input-box-wrap"><input type="tel" id="editWalletPhone" value="${document.getElementById('walletPhone')?.value || ''}" oninput="convertArabicNumbersToEnglish(this)"></div>
            `;
        } else if (selectedPaymentMethod === 'USDT') {
            payoutWrap.innerHTML = `
                <label class="field-label">عنوان USDT:</label><div class="input-box-wrap"><input type="text" id="editUsdtAddr" value="${document.getElementById('usdtAddress')?.value || ''}"></div>
            `;
        } else {
            payoutWrap.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted);">طريقة الدفع الحالية: ${selectedPaymentMethod}</div>`;
        }
    }

    showScreen('step3ReviewScreen');
}

function toggleEditMode() {
    isEditingAll = !isEditingAll;
    const btn = document.getElementById('editToggleBtn');
    
    ['editPlatformQtyPanel', 'eaEditMode', 'clientEditMode', 'payoutEditMode', 'saveEditsButtonWrap'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !isEditingAll);
    });
    ['eaViewMode', 'clientViewMode', 'payoutViewMode'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', isEditingAll);
    });

    if (isEditingAll) {
        if(btn) {
            btn.innerHTML = `<i class="fa-solid fa-xmark"></i> إغلاق التعديل`;
            btn.style.background = "rgba(239, 68, 68, 0.15)";
            btn.style.borderColor = "var(--pc-color)";
            btn.style.color = "var(--pc-color)";
        }
    } else {
        const newEmail = document.getElementById('editEaEmail')?.value || '';
        const newPass = document.getElementById('editEaPass')?.value || '';
        const newC1 = document.getElementById('editCode1')?.value || '';
        const newC2 = document.getElementById('editCode2')?.value || '';
        const newC3 = document.getElementById('editCode3')?.value || '';
        const newName = document.getElementById('editClientName')?.value || '';
        const newPhone = document.getElementById('editClientPhone')?.value || '';

        if(document.getElementById('eaEmail')) document.getElementById('eaEmail').value = newEmail;
        if(document.getElementById('eaPass')) document.getElementById('eaPass').value = newPass;
        if(document.getElementById('customerName')) document.getElementById('customerName').value = newName;
        if(document.getElementById('customerPhone')) document.getElementById('customerPhone').value = newPhone;

        const revEmailEl = document.getElementById('revEmail');
        const revPassEl = document.getElementById('revPass');
        const revCodesEl = document.getElementById('revCodes');
        const revClientNameEl = document.getElementById('revClientName');
        const revClientPhoneEl = document.getElementById('revClientPhone');

        if(revEmailEl) revEmailEl.innerText = newEmail;
        if(revPassEl) revPassEl.innerText = newPass;
        if(revCodesEl) revCodesEl.innerHTML = `<div class="backup-codes-stack"><div class="code-display-row"><span class="code-number-tag">#1</span> <span>${newC1}</span></div><div class="code-display-row"><span class="code-number-tag">#2</span> <span>${newC2}</span></div><div class="code-display-row"><span class="code-number-tag">#3</span> <span>${newC3}</span></div></div>`;
        if(revClientNameEl) revClientNameEl.innerText = newName;
        if(revClientPhoneEl) revClientPhoneEl.innerText = newPhone;

        if (selectedPaymentMethod === 'تحويل بنكي') {
            if(document.getElementById('bankNameSelect')) document.getElementById('bankNameSelect').value = document.getElementById('editBankName')?.value || 'الراجحي';
            if(document.getElementById('bankFullName')) document.getElementById('bankFullName').value = document.getElementById('editBankFullName')?.value || '';
            if(document.getElementById('bankIban')) document.getElementById('bankIban').value = document.getElementById('editBankIban')?.value || '';
        } else if (selectedPaymentMethod === 'المحافظ الرقمية') {
            if(document.getElementById('walletPhone')) document.getElementById('walletPhone').value = document.getElementById('editWalletPhone')?.value || '';
        } else if (selectedPaymentMethod === 'USDT') {
            if(document.getElementById('usdtAddress')) document.getElementById('usdtAddress').value = document.getElementById('editUsdtAddr')?.value || '';
        }

        const revSpecDetails = document.getElementById('revSpecificDetailsContainer');
        if(revSpecDetails) revSpecDetails.innerHTML = buildPaymentDetailsHTML();

        if(btn) {
            btn.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> تعديل الكل`;
            btn.style.background = "rgba(0,210,255,0.12)";
            btn.style.borderColor = "var(--accent-color)";
            btn.style.color = "var(--accent-color)";
        }
    }
}

function selectPlatformInline(platform) {
    selectPlatform(platform);
    const platBox = document.getElementById('revPlatformBoxTheme');
    const revIcon = document.getElementById('revPlatformIcon');
    if(platBox && revIcon) {
        platBox.className = "review-styled-box";
        if (platform === 'PlayStation') { platBox.classList.add('ps-theme'); revIcon.className = "fa-brands fa-playstation"; }
        else if (platform === 'Xbox') { platBox.classList.add('xbox-theme'); revIcon.className = "fa-brands fa-xbox"; }
        else if (platform === 'PC') { platBox.classList.add('pc-theme'); revIcon.className = "fa-solid fa-desktop"; }
    }

    const revTotalEl = document.getElementById('revTotal');
    if(revTotalEl) revTotalEl.innerText = document.getElementById('totalAmountText')?.innerText || '';
}

function adjustQtyInline(amount) {
    adjustQty(amount);
    const inlineQtyInputEl = document.getElementById('inlineQtyInput');
    const revQtyEl = document.getElementById('revQty');
    const revTotalEl = document.getElementById('revTotal');

    if(inlineQtyInputEl) inlineQtyInputEl.value = currentQty > 0 ? currentQty.toLocaleString('en-US') : '';
    if(revQtyEl) revQtyEl.innerText = currentQty.toLocaleString('en-US');
    if(revTotalEl) revTotalEl.innerText = document.getElementById('totalAmountText')?.innerText || '';
}

function formatAndCalculateInline(input) {
    formatAndCalculate(input);
    const revQtyEl = document.getElementById('revQty');
    const revTotalEl = document.getElementById('revTotal');

    if(revQtyEl) revQtyEl.innerText = currentQty.toLocaleString('en-US');
    if(revTotalEl) revTotalEl.innerText = document.getElementById('totalAmountText')?.innerText || '';
}

async function submitOrderFinal() {
    if(isEditingAll) toggleEditMode();

    const clientName = document.getElementById('customerName')?.value.trim() || '';
    const clientPhone = document.getElementById('customerPhone')?.value.trim() || '';
    const emailVal = document.getElementById('eaEmail')?.value.trim() || '';
    const passVal = document.getElementById('eaPass')?.value.trim() || '';
    const c1 = document.getElementById('code1')?.value.trim() || '';
    const c2 = document.getElementById('code2')?.value.trim() || '';
    const c3 = document.getElementById('code3')?.value.trim() || '';
    const totalVal = document.getElementById('totalAmountText')?.innerText || '';

    try {
        // 1. توليد رقم الطلب عبر النظام المركزي system.js
        generatedOrderId = await createOrderId(selectedPlatform);

        // 2. حفظ كافة بيانات الطلب في Firestore مباشرة بحالة pending
        await addDoc(collection(db, "orders"), {
            orderId: generatedOrderId,
            createdAt: serverTimestamp(),
            status: "pending",
            customerName: clientName,
            customerPhone: clientPhone,
            platform: selectedPlatform,
            quantity: currentQty,
            total: totalVal,
            paymentMethod: selectedPaymentMethod,
            eaEmail: emailVal,
            eaPassword: passVal,
            backupCodes: [c1, c2, c3]
        });
    } catch (error) {
        console.error("Error submitting order to Firestore:", error);
    }
    
    const finalOrderIdEl = document.getElementById("finalOrderId");
    if(finalOrderIdEl) finalOrderIdEl.innerText = generatedOrderId;
    
    const billClientNameEl = document.getElementById('billClientName');
    const billClientPhoneEl = document.getElementById('billClientPhone');
    const billPlatformEl = document.getElementById('billPlatform');
    const billQtyEl = document.getElementById('billQty');
    const billTotalEl = document.getElementById('billTotal');
    const billPaymentCardEl = document.getElementById('billPaymentCard');

    if(billClientNameEl) billClientNameEl.innerText = clientName;
    if(billClientPhoneEl) billClientPhoneEl.innerText = clientPhone;
    if(billPlatformEl) billPlatformEl.innerText = selectedPlatform || '';
    if(billQtyEl) billQtyEl.innerText = `${currentQty.toLocaleString('en-US')} كوينز`;
    if(billTotalEl) billTotalEl.innerText = totalVal;

    if(billPaymentCardEl) billPaymentCardEl.innerHTML = `<div class="box-card-title"><i class="fa-solid fa-wallet"></i> تفاصيل التحويل والاستلام</div>${buildPaymentDetailsHTML()}`;

    showScreen('step4SuccessScreen');
}

function openModal(title, content) {
    const modalTitleEl = document.getElementById('modalTitle');
    const modalBodyContentEl = document.getElementById('modalBodyContent');
    const customModalEl = document.getElementById('customModal');

    if(modalTitleEl) modalTitleEl.innerText = title;
    if(modalBodyContentEl) modalBodyContentEl.innerHTML = content;
    if(customModalEl) customModalEl.classList.add('active');
}

function closeModal() { 
    document.getElementById('customModal')?.classList.remove('active'); 
}

function openBackupGuideModal() { 
    openModal('طريقة استخراج الأكواد الاحتياطية', '<div style="text-align:right;"><p>1. قم بتسجيل الدخول إلى حسابك في موقع EA عبر الرابط الرسمي.<br>2. اذهب إلى إعدادات الحساب (Account Settings).<br>3. اختر تبويب الأمان (Security).<br>4. ابحث عن خيار Backup Codes وانقر على View لاستخراج الأكواد.</p></div>'); 
}

function showSupportModal() { 
    openModal('الدعم الفني والخدمة', '<div style="text-align:center;"><p style="margin-bottom:10px;">نحن هنا لخدمتك على مدار الساعة طوال أيام الأسبوع.</p><a href="https://wa.me/966570770465" target="_blank" style="background:#25D366; color:#000; padding:10px 20px; border-radius:10px; font-weight:bold; display:inline-block; text-decoration:none;"><i class="fa-brands fa-whatsapp"></i> التواصل المباشر عبر واتساب</a></div>'); 
}

function showPrivacyModal() { 
    openModal('سياسة الخصوصية والأمان', '<div style="text-align:right;"><p>نحن نضمن حماية كافة بياناتك وحساباتك بأعلى معايير التشفير والأمان المعتمدة عالمياً دون مشاركتها مع أي طرف ثالث.</p></div>'); 
}

function showTermsModal() { 
    openModal('شروط وقواعد الخدمة', '<div style="text-align:right;"><p>يجب التأكد من صحة بيانات الحساب والأكواد الاحتياطية، وأن يكون سوق الانتقالات مفتوحاً في تطبيق الويب لضمان سرعة إنجاز الطلب في المواعيد المحددة.</p></div>'); 
}

function copyOrderId() { 
    if (generatedOrderId) {
        navigator.clipboard.writeText(generatedOrderId);
    }
}

function openInquiryPage() { 
    alert('شاشة تتبع الطلبات والاستعلامات'); 
}

function sendOrderViaWhatsapp() {
    const clientName = document.getElementById('customerName')?.value.trim() || '--';
    const clientPhone = document.getElementById('customerPhone')?.value.trim() || '--';
    const emailVal = document.getElementById('eaEmail')?.value.trim() || '--';
    const passVal = document.getElementById('eaPass')?.value.trim() || '--';
    const c1 = document.getElementById('code1')?.value.trim() || '--';
    const c2 = document.getElementById('code2')?.value.trim() || '--';
    const c3 = document.getElementById('code3')?.value.trim() || '--';
    const totalVal = document.getElementById('totalAmountText')?.innerText || '--';

    let paymentDetailsText = "";
    if (selectedPaymentMethod === 'تحويل بنكي') {
        const bank = document.getElementById('bankNameSelect')?.value || 'الراجحي';
        const name = document.getElementById('bankFullName')?.value.trim() || '';
        const iban = document.getElementById('bankIban')?.value.trim() || '';
        paymentDetailsText = `• طريقة الدفع: تحويل بنكي (${bank})\n• اسم الحساب والإيبان: ${name} - ${iban}`;
    } else if (selectedPaymentMethod === 'المحافظ الرقمية') {
        const wallet = document.getElementById('walletNameSelect')?.value || 'STC Pay';
        const phone = document.getElementById('walletPhone')?.value.trim() || '';
        paymentDetailsText = `• طريقة الدفع: ${wallet} (${phone})`;
    } else if (selectedPaymentMethod === 'USDT') {
        const addr = document.getElementById('usdtAddress')?.value.trim() || '';
        paymentDetailsText = `• طريقة الدفع: USDT (${addr})`;
    } else {
        paymentDetailsText = `• طريقة الدفع: ${selectedPaymentMethod}`;
    }

    const message = `طلب بيع جديد

📋 رقم الطلب: ${generatedOrderId}
👤 اسم العميل: ${clientName}
📱 رقم الواتساب: ${clientPhone}

🎮 المنصة: ${selectedPlatform}
💰 الكمية: ${currentQty.toLocaleString('en-US')} كوينز
💵 إجمالي المبلغ: ${totalVal}

${paymentDetailsText}

🔐 بيانات حساب EA:
• البريد: ${emailVal}
• كلمة المرور: ${passVal}
• الأكواد الاحتياطية:
  #1: ${c1}
  #2: ${c2}
  #3: ${c3}`;

    const url = `https://wa.me/${supportWhatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
}

// تثبيت كافة الدوال عالمياً على window
window.convertArabicNumbersToEnglish = convertArabicNumbersToEnglish;
window.selectPlatform = selectPlatform;
window.updateRateCardsUI = updateRateCardsUI;
window.switchPaymentCategory = switchPaymentCategory;
window.updateDynamicUI = updateDynamicUI;
window.selectPaymentMethod = selectPaymentMethod;
window.adjustQty = adjustQty;
window.formatAndCalculate = formatAndCalculate;
window.sliderChanged = sliderChanged;
window.calculateTotal = calculateTotal;
window.renderStep2PaymentFields = renderStep2PaymentFields;
window.showScreen = showScreen;
window.goToStep2 = goToStep2;
window.buildPaymentDetailsHTML = buildPaymentDetailsHTML;
window.goToReview = goToReview;
window.toggleEditMode = toggleEditMode;
window.selectPlatformInline = selectPlatformInline;
window.adjustQtyInline = adjustQtyInline;
window.formatAndCalculateInline = formatAndCalculateInline;
window.submitOrderFinal = submitOrderFinal;
window.openModal = openModal;
window.closeModal = closeModal;
window.openBackupGuideModal = openBackupGuideModal;
window.showSupportModal = showSupportModal;
window.showPrivacyModal = showPrivacyModal;
window.showTermsModal = showTermsModal;
window.copyOrderId = copyOrderId;
window.openInquiryPage = openInquiryPage;
window.sendOrderViaWhatsapp = sendOrderViaWhatsapp;
